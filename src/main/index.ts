import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { serveFs, serveOs } from "@carapace/shell/node";
import electronUpdater from "electron-updater";

// electron-updater is CJS; its named exports come off the default import under bundling.
const { autoUpdater } = electronUpdater;

// unpackaged dev runs report the app name as "Electron"; pin it so userData
// (session memory) lands in ~/.config/lambert instead of the shared Electron dir
app.setName("lambert");

const isAutomation = process.argv.includes("--selftest") || process.argv.includes("--capture");
if (isAutomation) {
  // Automated runs must not share the live instance's profile: LevelDB/Dawn cache locks make captures
  // flaky-black and stall GPU init when an editor is open. Each run gets a FRESH unique dir by default
  // (a fixed, never-cleared dir let stale session/state leak between runs and collided when two ran at
  // once); pass --profile <dir> to use a prepared profile instead (the seeded-session workflow).
  const profileIndex = process.argv.indexOf("--profile");
  const profileDir = profileIndex >= 0 ? process.argv[profileIndex + 1] : undefined;
  app.setPath("userData", profileDir ?? mkdtempSync(path.join(os.tmpdir(), "lambert-automation-")));
}

// WebGPU is default-on for Windows/macOS Chromium but flag-gated on Linux. `enable-unsafe-webgpu`
// is backend-neutral and safe everywhere (relaxes limits / exposes experimental bits). The Vulkan
// switches are LINUX-ONLY: Dawn has no D3D/Metal backend there, so it needs Vulkan + ANGLE-on-Vulkan
// explicitly. Forcing them on Windows (ANGLE default d3d11) / macOS (metal) steers the whole GPU
// stack onto Vulkan — and on any box where Chromium blocklists Vulkan (common on Windows: old Intel
// drivers, VMs, RDP), the GPU process falls back to software and requestAdapter() returns null.
// Must run before app is ready.
app.commandLine.appendSwitch("enable-unsafe-webgpu");
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "Vulkan,VulkanFromANGLE");
  app.commandLine.appendSwitch("use-angle", "vulkan");
}

// Dev only: never serve the renderer from Electron's on-disk HTTP cache. It can pin a stale build of
// the UI (e.g. an old toolbar logo) even after the Vite dev server already serves the new code — so
// fresh `pnpm dev` launches kept showing pre-edit UI, which is maddening to debug. Packaged builds
// load the renderer from file:// and are unaffected.
if (!app.isPackaged) app.commandLine.appendSwitch("disable-http-cache");

const selftest = process.argv.includes("--selftest");
const captureIndex = process.argv.indexOf("--capture");
const capturePath = captureIndex >= 0 ? process.argv[captureIndex + 1] : undefined;
const queryIndex = process.argv.indexOf("--query");
const extraQuery = queryIndex >= 0 ? process.argv[queryIndex + 1] : undefined;

// Opening a project by double-clicking its project.lambert (OS file association / "open with").
// Linux & Windows pass the path in argv; macOS delivers it via the open-file event. A project.lambert
// file resolves to its containing folder; a folder is passed through (the renderer validates the marker).
const PROJECT_MARKER = "project.lambert";
const projectDirFromArg = (arg: string): string =>
  path.basename(arg) === PROJECT_MARKER ? path.dirname(arg) : arg;
function projectArgFromArgv(argv: string[]): string | null {
  const args = argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--query" || a === "--capture") {
      i++; // skip the flag's value too
      continue;
    }
    if (a === "." || a.startsWith("-")) continue; // app path / electron switches
    return projectDirFromArg(a);
  }
  return null;
}

// Crash-safe persistence: write to a unique sibling temp file, then atomic rename over the target.
// A crash/OOM/power-loss mid-write leaves the temp (garbage) behind and the real file untouched,
// instead of a half-truncated .lmb/session/cache. The unique per-write suffix also stops two
// concurrent writers to the same path (e.g. the debounced session stash racing the close-flush)
// from clobbering each other's temp; the renames still last-writer-win, which is fine for a
// "latest state" stash. Same-directory temp keeps the rename on one filesystem (so it's atomic).
// The 8-byte PNG signature. Diffuse sources are always PNG (the renderer decodes with fast-png), so a
// body that doesn't start with this is an error page / wrong URL / truncated download, not a diffuse.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (bytes: Uint8Array): boolean =>
  bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);

let atomicSeq = 0;
async function atomicWrite(target: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${target}.${process.pid}.${atomicSeq++}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

let mainWindow: BrowserWindow | null = null;
// a project the OS asked us to open, captured before the window/renderer exists; consumed on mount
let pendingProjectPath: string | null = isAutomation ? null : projectArgFromArgv(process.argv);
const sendOpenProject = (dir: string): void => mainWindow?.webContents.send("open-project-path", dir);

// macOS "open with" / double-click; may fire before app is ready
app.on("open-file", (e, p) => {
  e.preventDefault();
  const dir = projectDirFromArg(p);
  if (mainWindow) sendOpenProject(dir);
  else pendingProjectPath = dir;
});

// Single instance (packaged only): a second "open project.lambert" focuses the running window and
// opens there instead of spawning a rival that fights over the session file. Dev & automation launch
// freely (separate userData → separate lock anyway).
const gotInstanceLock = !app.isPackaged || isAutomation || app.requestSingleInstanceLock();
if (!gotInstanceLock) app.quit();
app.on("second-instance", (_e, argv) => {
  const dir = projectArgFromArgv(argv);
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  if (dir) sendOpenProject(dir);
});

// Set just before quitAndInstall so the unsaved-changes close guard lets the window close. Without
// it, app.quit() is vetoed by the guard, the update never installs, and "Restarting" hangs forever.
let installingUpdate = false;

// Autoupdate: offers before downloading (autoDownload off). The check IPC + events are always
// registered; the real autoUpdater only runs in a packaged build (it needs app-update.yml in
// resources). In dev a manual check just reports "up to date" so the UI stays exercised.
function setupAutoUpdate(win: BrowserWindow) {
  const send = (event: Record<string, unknown>) => win.webContents.send("update:event", event);

  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) {
      send({ type: "not-available" });
      return;
    }
    // A manual check can reject (404 when no release is published, or a network error). The auto-check
    // below swallows its own rejection; the manual path must too, or the renderer's invoke() rejects
    // and surfaces as an unhandled error. Report it as an update error event instead.
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      send({ type: "error", message: String((err as Error)?.message ?? err) });
    }
  });
  ipcMain.handle("update:download", async () => {
    if (!app.isPackaged) return;
    // downloadUpdate() can reject (a 404 on the asset, sha512 mismatch, network drop) WITHOUT always
    // emitting the "error" event, which would leave the renderer's invoke() rejecting into the void and
    // the banner stuck. Mirror update:check: catch and report it as an update error event.
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      send({ type: "error", message: String((err as Error)?.message ?? err) });
    }
  });
  ipcMain.handle("update:install", async () => {
    if (app.isPackaged) {
      installingUpdate = true; // bypass the unsaved-changes close guard so the quit actually goes through
      autoUpdater.quitAndInstall(false, true); // isForceRunAfter: relaunch the new version after install
    }
  });

  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
  autoUpdater.on("update-available", (info) => send({ type: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => send({ type: "not-available" }));
  autoUpdater.on("download-progress", (p) => send({ type: "progress", percent: p.percent }));
  autoUpdater.on("update-downloaded", (info) => send({ type: "downloaded", version: info.version }));
  autoUpdater.on("error", (err) => send({ type: "error", message: String(err?.message ?? err) }));
  // The quiet startup check is triggered by the renderer (UpdateNotice), gated on the
  // "Check for updates automatically" setting — the setting lives in renderer localStorage, which the
  // main process can't read, so the renderer owns the trigger. Main just services the update:check IPC.
}

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  ipcMain.handle("dialog:open", async (_e, opts: { title: string; filters: Electron.FileFilter[] }) => {
    const r = await dialog.showOpenDialog({ title: opts.title, filters: opts.filters, properties: ["openFile"] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle(
    "dialog:save",
    async (_e, opts: { title: string; defaultPath?: string; filters: Electron.FileFilter[] }) => {
      const r = await dialog.showSaveDialog({ title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters });
      return r.canceled ? null : r.filePath;
    },
  );
  ipcMain.handle("fs:read", async (_e, p: string) => new Uint8Array(await readFile(p)));
  ipcMain.handle("fs:write", async (_e, p: string, data: Uint8Array) => {
    await atomicWrite(p, data);
  });

  // Remote diffuse fetch + cache. Fetched here (no renderer CORS/CSP), cached in userData keyed by a
  // hash of the URL so a committed .lmb resolves offline once seen. refresh forces a re-fetch.
  const diffuseCacheDir = path.join(app.getPath("userData"), "diffuse-cache");
  ipcMain.handle("net:fetchUrl", async (_e, url: string, opts?: { refresh?: boolean }) => {
    const cacheFile = path.join(diffuseCacheDir, createHash("sha256").update(url).digest("hex"));
    if (!opts?.refresh && existsSync(cacheFile)) return new Uint8Array(await readFile(cacheFile));
    let bytes: Uint8Array;
    try {
      // Time-box the fetch: a slow/hung server otherwise stalls New/Open/Restore indefinitely with no
      // cancel and no feedback.
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
      // Validate it's actually a PNG (Lambert's only diffuse format) before trusting/caching it — a
      // "200 OK" HTML error page or a truncated body would otherwise be cached and served forever.
      if (!isPng(bytes)) throw new Error("response is not a PNG image (wrong URL or an error page?)");
    } catch (err) {
      if (existsSync(cacheFile)) return new Uint8Array(await readFile(cacheFile)); // offline → fall back to cache
      throw new Error(`couldn't fetch the diffuse (${url}) and it isn't cached: ${String(err)}`);
    }
    await mkdir(diffuseCacheDir, { recursive: true });
    await atomicWrite(cacheFile, bytes);
    return bytes;
  });

  ipcMain.handle("dialog:openFolder", async (_e, opts: { title: string; defaultPath?: string }) => {
    const r = await dialog.showOpenDialog({
      title: opts.title,
      defaultPath: opts.defaultPath,
      properties: ["openDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("fs:exists", async (_e, p: string) => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggleMaximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle("fs:mkdir", async (_e, p: string) => {
    await mkdir(p, { recursive: true });
  });

  // `git status --porcelain=v1 -z` in the given dir — raw stdout for the renderer's clean-room parser
  // (Explorer SCM row tinting). Any failure (no git, not a repo) degrades to "" = no decorations.
  ipcMain.handle("git:status", async (_e, dir: string) => {
    try {
      return await new Promise<string>((resolve) => {
        execFile("git", ["status", "--porcelain=v1", "-z"], { cwd: dir, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
          resolve(err ? "" : stdout),
        );
      });
    } catch {
      return "";
    }
  });

  // session memory: last working state, stashed in userData (see src/document/session.ts)
  const sessionPath = path.join(app.getPath("userData"), "session.json");
  ipcMain.handle("session:load", async () => {
    try {
      return await readFile(sessionPath, "utf8");
    } catch {
      return null;
    }
  });
  ipcMain.handle("session:save", async (_e, json: string) => {
    await atomicWrite(sessionPath, json);
  });
  // "Open Containing Folder" (tab context menu): highlight the file in the OS file manager
  ipcMain.handle("path:reveal", (_e, p: string) => {
    shell.showItemInFolder(p);
  });

  // the renderer pulls any OS-requested project (double-clicked project.lambert) once, on mount
  ipcMain.handle("project:take-pending-open", () => {
    const dir = pendingProjectPath;
    pendingProjectPath = null;
    return dir;
  });

  // Window geometry: land on the launch screen in a compact, centered "welcome" window, then grow
  // to the remembered editor bounds once a project opens. When a prior session will auto-restore a
  // project, skip the welcome size and open straight at the remembered bounds (no resize flash).
  type Bounds = { width: number; height: number; x?: number; y?: number };
  const windowStatePath = path.join(app.getPath("userData"), "window.json");
  const WELCOME_BOUNDS: Bounds = { width: 960, height: 680 };
  const DEFAULT_EDITOR_BOUNDS: Bounds = { width: 1280, height: 760 };
  const readJsonSync = <T>(p: string): T | null => {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch {
      return null;
    }
  };
  const savedBounds = readJsonSync<Bounds>(windowStatePath);
  // Only "restoring" if the project still exists — a stale/dead pointer (e.g. a removed demo project)
  // must fall through to the welcome-sized launch screen, not open editor-sized on nothing.
  const sessionProjectPath = readJsonSync<{ projectPath?: string | null }>(sessionPath)?.projectPath;
  const restoringProject = !!sessionProjectPath && existsSync(path.join(sessionProjectPath, PROJECT_MARKER));
  // welcome size only when we'll actually land on the launch screen — not when a session restores a
  // project, nor when the OS handed us a project.lambert to open
  let welcomeMode = !restoringProject && !pendingProjectPath;
  const initialBounds = welcomeMode ? WELCOME_BOUNDS : (savedBounds ?? DEFAULT_EDITOR_BOUNDS);

  const winOpts: Electron.BrowserWindowConstructorOptions = {
    width: initialBounds.width,
    height: initialBounds.height,
    // the welcome size is also the floor: the window never shrinks below it (the editor may grow,
    // the home screen has no reason to). Keeps both layouts from breaking when dragged too small.
    minWidth: WELCOME_BOUNDS.width,
    minHeight: WELCOME_BOUNDS.height,
    show: !selftest,
    // chromeless (vscode-style): the carapace TopBar is the titlebar — draggable region + in-bar
    // window controls (window:* IPC below)
    frame: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      // electron-vite emits the preload as ESM (.mjs); Electron only loads ESM preloads
      // with the renderer sandbox off. contextIsolation stays on.
      sandbox: false,
    },
  };
  // restore the saved position too (only in editor mode — welcome mode stays centered)
  if (!welcomeMode && savedBounds?.x !== undefined && savedBounds.y !== undefined) {
    winOpts.x = savedBounds.x;
    winOpts.y = savedBounds.y;
  }
  const win = new BrowserWindow(winOpts);
  mainWindow = win;

  // renderer links (target=_blank, e.g. the About credits) open in the OS browser, never a popup
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Persist editor bounds (debounced) so "remembered state" survives restarts. Never while on the
  // welcome screen (its compact size must not overwrite the editor geometry) or in automation.
  let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = (): void => {
    if (welcomeMode || isAutomation) return;
    if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      const b = win.getBounds();
      void atomicWrite(windowStatePath, JSON.stringify({ width: b.width, height: b.height, x: b.x, y: b.y })).catch(
        () => {},
      );
    }, 400);
  };
  win.on("resize", persistBounds);
  win.on("move", persistBounds);

  // The renderer signals when a project opens; grow the welcome window to the remembered editor size.
  ipcMain.on("window:enter-project", () => {
    if (!welcomeMode) return;
    welcomeMode = false;
    const b = savedBounds ?? DEFAULT_EDITOR_BOUNDS;
    if (b.x !== undefined && b.y !== undefined) {
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    } else {
      win.setSize(b.width, b.height);
      win.center();
    }
  });

  // carapace fs protocol: backs the shared <FileExplorer> (renderer createIpcFs <-> this).
  // Default real-path provider (createNodeFs) — Lambert addresses files by absolute path.
  serveFs(ipcMain, { send: (channel, ...args) => win.webContents.send(channel, ...args) });
  serveOs(ipcMain, { shell, resolve: (p) => p }); // real absolute paths — no virtual schemes to resolve

  setupAutoUpdate(win);

  // Application menu: file/edit actions route to the renderer as menu:action events; accelerators
  // live here so they are real OS-level shortcuts. The defaults below match src/ui/commands.ts; the
  // renderer pushes the user's EFFECTIVE bindings on startup and on every rebind
  // (menu:accelerators), and the menu is rebuilt so rebound shortcuts stay OS-level.
  const send = (action: string) => () => win.webContents.send("menu:action", action);
  const DEFAULT_ACCELERATORS: Record<string, string | null> = {
    "new-project": "Ctrl+Shift+N",
    "open-project": "Ctrl+O",
    "new-document": "Ctrl+N",
    save: "Ctrl+S",
    "save-all": "Ctrl+Shift+S",
    "export-nx": "Ctrl+E",
    "export-all": "Ctrl+Shift+E",
    settings: "Ctrl+,",
    undo: "Ctrl+Z",
    redo: "Ctrl+Y",
    duplicate: "Ctrl+D",
    group: "Ctrl+G",
    ungroup: "Ctrl+Shift+G",
    "zoom-fit": "Ctrl+0",
    "zoom-fit-selection": "Ctrl+Shift+0",
    "zoom-100": "Ctrl+1",
    "toggle-rulers": "Ctrl+R",
    "command-palette": "Ctrl+Shift+P",
  };
  const installAppMenu = (accelerators: Record<string, string | null>): void => {
    // renderer chords say "Ctrl"; make them portable OS accelerators
    const acc = (id: string): string | undefined => {
      const keys = id in accelerators ? accelerators[id] : DEFAULT_ACCELERATORS[id];
      return keys ? keys.replace(/(^|\+)Ctrl(\+|$)/, "$1CmdOrCtrl$2") : undefined;
    };
    const item = (label: string, id: string): Electron.MenuItemConstructorOptions => ({
      label,
      accelerator: acc(id),
      click: send(id),
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "File",
          submenu: [
            item("New Project…", "new-project"),
            item("Open Project…", "open-project"),
            { type: "separator" },
            item("New Document…", "new-document"),
            item("Reload Diffuse", "reload-diffuse"),
            { type: "separator" },
            item("Save", "save"),
            item("Save All", "save-all"),
            item("Close Tab", "close-tab"),
            { type: "separator" },
            item("Export NX", "export-nx"),
            item("Export Height Map", "export-height"),
            item("Export All NX", "export-all"),
            { type: "separator" },
            item("Preferences…", "preferences"),
            item("Project Settings…", "project-settings"),
            item("Document Settings…", "document-settings"),
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            item("Undo", "undo"),
            item("Redo", "redo"),
            { type: "separator" },
            item("Duplicate", "duplicate"),
            { label: "Delete", click: send("delete") }, // no accelerator: Del must stay safe in inputs
            { label: "Rename", click: send("rename") }, // no accelerator: F2 fires via the window keymap
            { label: "Deselect", click: send("deselect") }, // no accelerator: editor-scope, window keymap
            { type: "separator" },
            item("Group", "group"),
            item("Ungroup", "ungroup"),
          ],
        },
        {
          label: "View",
          submenu: [
            item("Fit", "zoom-fit"),
            item("Fit Selection", "zoom-fit-selection"),
            item("100%", "zoom-100"),
            item("Zoom In", "zoom-in"),
            item("Zoom Out", "zoom-out"),
            { type: "separator" },
            item("Next Tab", "tab-next"),
            item("Previous Tab", "tab-prev"),
            { type: "separator" },
            item("Rulers", "toggle-rulers"),
            item("Pixel Grid", "toggle-pixel-grid"),
            item("Command Palette…", "command-palette"),
            { type: "separator" },
            { role: "toggleDevTools" },
          ],
        },
        {
          label: "Help",
          submenu: [item("Check for Updates…", "check-updates")],
        },
      ]),
    );
  };
  installAppMenu({});
  ipcMain.handle("menu:accelerators", (_e, map: Record<string, string | null>) => installAppMenu(map));
  // The menu is rendered in-window (carapace MenuBar in the toolbar). Keep the native menu set so its
  // accelerators stay live, but hide the native bar so it isn't shown twice (autoHideMenuBar stays
  // false, so it won't reappear on Alt either).
  win.setMenuBarVisibility(false);

  // unsaved-changes guard: only armed once the editor renderer registers, so the
  // harness/selftest/capture routes keep closing freely
  let closeGuarded = false;
  let allowClose = false;
  ipcMain.on("guard-close", () => {
    closeGuarded = true;
  });
  ipcMain.on("close-response", (_e, ok: boolean) => {
    if (ok) {
      allowClose = true;
      win.close();
    }
  });
  win.on("close", (e) => {
    if (!closeGuarded || allowClose || selftest || capturePath || installingUpdate) return;
    e.preventDefault();
    win.webContents.send("confirm-close");
  });

  if (selftest) {
    ipcMain.once("selftest-result", (_event, report: { pass: boolean }) => {
      console.log(JSON.stringify(report, null, 2));
      app.exit(report.pass ? 0 : 1);
    });
    setTimeout(() => {
      console.error("selftest timed out after 60s");
      app.exit(2);
    }, 60_000);
  }

  if (capturePath) {
    // screenshot for automated visual checks. Deterministic, not timer-based: poll until
    // the UI reports ready (react mounted; demo content flagged), settle, then capture —
    // a fixed delay raced slow chunk imports / first WebGPU present and captured black.
    win.webContents.once("did-finish-load", () => {
      const started = Date.now();
      const READY_PROBE = `(() => {
        const r = document.getElementById("root");
        const editor = r !== null && r.childElementCount > 0;
        const harness = document.getElementById("views")?.childElementCount ?? 0;
        const demo = new URLSearchParams(location.search).has("demo");
        const demoReady = !demo || (window.__lambertDemoReady === true && window.__lambertFrameReady === true);
        return (editor || harness > 0) && demoReady;
      })()`;
      const tryCapture = async (): Promise<void> => {
        const ready = await win.webContents.executeJavaScript(READY_PROBE).catch(() => false);
        if (!ready && Date.now() - started < 15000) {
          setTimeout(() => void tryCapture(), 400);
          return;
        }
        setTimeout(async () => {
          const image = await win.webContents.capturePage();
          const { writeFileSync } = await import("node:fs");
          writeFileSync(capturePath, image.toPNG());
          console.log(`captured ${capturePath}`);
          app.exit(0);
        }, 1500);
      };
      setTimeout(() => void tryCapture(), 400);
    });
  }

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  const query = selftest ? "?selftest=1" : extraQuery ? `?${extraQuery}` : "";
  if (devUrl) {
    void win.loadURL(devUrl + query);
  } else {
    void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"), { search: query });
  }
});

app.on("window-all-closed", () => app.quit());
