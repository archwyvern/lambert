import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { access, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveFs } from "@carapace/shell/node";
import electronUpdater from "electron-updater";

// electron-updater is CJS; its named exports come off the default import under bundling.
const { autoUpdater } = electronUpdater;

// unpackaged dev runs report the app name as "Electron"; pin it so userData
// (session memory) lands in ~/.config/lambert instead of the shared Electron dir
app.setName("lambert");

const isAutomation = process.argv.includes("--selftest") || process.argv.includes("--capture");
if (isAutomation) {
  // automated runs must not share the live instance's profile: LevelDB/Dawn cache
  // locks make captures flaky-black and stall GPU init when an editor is open
  app.setPath("userData", path.join(os.tmpdir(), "lambert-automation"));
}

// WebGPU is default-on for Windows/macOS Chromium but flag-gated on Linux; we own the
// flags, so force it everywhere. Must run before app is ready.
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-features", "Vulkan,VulkanFromANGLE");
app.commandLine.appendSwitch("use-angle", "vulkan");

const selftest = process.argv.includes("--selftest");
const captureIndex = process.argv.indexOf("--capture");
const capturePath = captureIndex >= 0 ? process.argv[captureIndex + 1] : undefined;
const queryIndex = process.argv.indexOf("--query");
const extraQuery = queryIndex >= 0 ? process.argv[queryIndex + 1] : undefined;

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
    await autoUpdater.checkForUpdates();
  });
  ipcMain.handle("update:download", async () => {
    if (app.isPackaged) await autoUpdater.downloadUpdate();
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

  // Quiet check shortly after launch (auto checks never surface "up to date").
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 4000);
  });
}

app.whenReady().then(() => {
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
    await writeFile(p, data);
  });

  ipcMain.handle("dialog:openFolder", async (_e, opts: { title: string }) => {
    const r = await dialog.showOpenDialog({ title: opts.title, properties: ["openDirectory"] });
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
    await writeFile(sessionPath, json, "utf8");
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    show: !selftest,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      // electron-vite emits the preload as ESM (.mjs); Electron only loads ESM preloads
      // with the renderer sandbox off. contextIsolation stays on.
      sandbox: false,
    },
  });

  // carapace fs protocol: backs the shared <FileExplorer> (renderer createIpcFs <-> this).
  // Default real-path provider (createNodeFs) — Lambert addresses files by absolute path.
  serveFs(ipcMain, { send: (channel, ...args) => win.webContents.send(channel, ...args) });

  setupAutoUpdate(win);

  // application menu: file/edit actions route to the renderer as menu:action events;
  // accelerators live here so they are real OS-level shortcuts
  const send = (action: string) => () => win.webContents.send("menu:action", action);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          { label: "New Project…", accelerator: "CmdOrCtrl+Shift+N", click: send("new-project") },
          { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: send("open-project") },
          { type: "separator" },
          { label: "Save", accelerator: "CmdOrCtrl+S", click: send("save") },
          { label: "Save All", accelerator: "CmdOrCtrl+Shift+S", click: send("save-all") },
          { type: "separator" },
          { label: "Export NX", accelerator: "CmdOrCtrl+E", click: send("export-nx") },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { label: "Undo", accelerator: "CmdOrCtrl+Z", click: send("undo") },
          { label: "Redo", accelerator: "CmdOrCtrl+Y", click: send("redo") },
          { type: "separator" },
          { label: "Duplicate", accelerator: "CmdOrCtrl+D", click: send("duplicate") },
          { label: "Delete", click: send("delete") }, // no accelerator: Del must stay safe in inputs
          { type: "separator" },
          { label: "Group", accelerator: "CmdOrCtrl+G", click: send("group") },
          { label: "Ungroup", accelerator: "CmdOrCtrl+Shift+G", click: send("ungroup") },
        ],
      },
      {
        label: "View",
        submenu: [
          { label: "Fit", accelerator: "CmdOrCtrl+0", click: send("zoom-fit") },
          { label: "100%", accelerator: "CmdOrCtrl+1", click: send("zoom-100") },
          { type: "separator" },
          { label: "Rulers", accelerator: "CmdOrCtrl+R", click: send("toggle-rulers") },
          { type: "separator" },
          { role: "toggleDevTools" },
        ],
      },
      {
        label: "Help",
        submenu: [{ label: "Check for Updates…", click: send("check-updates") }],
      },
    ]),
  );

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
