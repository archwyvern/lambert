import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// unpackaged dev runs report the app name as "Electron"; pin it so userData
// (session memory) lands in ~/.config/flatland instead of the shared Electron dir
app.setName("flatland");

const isAutomation = process.argv.includes("--selftest") || process.argv.includes("--capture");
if (isAutomation) {
  // automated runs must not share the live instance's profile: LevelDB/Dawn cache
  // locks make captures flaky-black and stall GPU init when an editor is open
  app.setPath("userData", path.join(os.tmpdir(), "flatland-automation"));
}

// WebGPU is default-on for Windows/macOS Chromium but flag-gated on Linux; we own the
// flags, so force it everywhere. Must run before app is ready.
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-features", "Vulkan,VulkanFromANGLE");
app.commandLine.appendSwitch("use-angle", "vulkan");

const selftest = process.argv.includes("--selftest");
const captureIndex = process.argv.indexOf("--capture");
const capturePath = captureIndex >= 0 ? process.argv[captureIndex + 1] : undefined;
const capture3dIndex = process.argv.indexOf("--capture3d");
const capture3dPath = capture3dIndex >= 0 ? process.argv[capture3dIndex + 1] : undefined;
const queryIndex = process.argv.indexOf("--query");
const extraQuery = queryIndex >= 0 ? process.argv[queryIndex + 1] : undefined;

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

  // application menu: file/edit actions route to the renderer as menu:action events;
  // accelerators live here so they are real OS-level shortcuts
  const send = (action: string) => () => win.webContents.send("menu:action", action);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          { label: "Open Image…", accelerator: "CmdOrCtrl+O", click: send("open-image") },
          { label: "Open Project…", accelerator: "CmdOrCtrl+Shift+O", click: send("open-project") },
          { type: "separator" },
          { label: "Save", accelerator: "CmdOrCtrl+S", click: send("save") },
          { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: send("save-as") },
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
        ],
      },
      {
        label: "View",
        submenu: [
          { label: "Fit", accelerator: "CmdOrCtrl+0", click: send("zoom-fit") },
          { label: "100%", accelerator: "CmdOrCtrl+1", click: send("zoom-100") },
          { type: "separator" },
          { role: "toggleDevTools" },
        ],
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
    if (!closeGuarded || allowClose || selftest || capturePath) return;
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
        const demoReady = !demo || (window.__flatlandDemoReady === true && window.__flatlandFrameReady === true);
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
  const loadInto = (w: BrowserWindow, q: string): void => {
    if (devUrl) void w.loadURL(devUrl + q);
    else void w.loadFile(path.join(import.meta.dirname, "../renderer/index.html"), { search: q });
  };

  // 3D pop-out: a child of the main window (always renders above it), its own renderer
  // process and WebGPU device — it re-folds the field from doc + diffuse pushed over IPC.
  let view3dWin: BrowserWindow | null = null;
  let redocking = false;
  ipcMain.on("view3d:open", () => {
    if (view3dWin && !view3dWin.isDestroyed()) {
      view3dWin.focus();
      return;
    }
    redocking = false;
    view3dWin = new BrowserWindow({
      width: 520,
      height: 560,
      parent: win, // child window: stays in front of the main window, closes with it
      title: "3D Preview",
      backgroundColor: "#191a1b",
      webPreferences: { preload: path.join(import.meta.dirname, "../preload/index.mjs"), sandbox: false },
    });
    view3dWin.setMenu(null);
    const child = view3dWin;
    child.on("closed", () => {
      view3dWin = null;
      // the main window may already be torn down (app quit); only notify if it survives
      if (!win.isDestroyed()) win.webContents.send(redocking ? "view3d:redocked" : "view3d:closed");
      redocking = false;
    });
    loadInto(child, "?view3d");
    if (capture3dPath) {
      child.webContents.once("did-finish-load", () => {
        const started = Date.now();
        const tick = async (): Promise<void> => {
          if (child.isDestroyed()) return;
          const ready = await child.webContents
            .executeJavaScript("window.__flatlandFrameReady === true")
            .catch(() => false);
          if (!ready && Date.now() - started < 15000) {
            setTimeout(() => void tick(), 400);
            return;
          }
          setTimeout(async () => {
            if (child.isDestroyed()) return;
            const { writeFileSync } = await import("node:fs");
            writeFileSync(capture3dPath, (await child.webContents.capturePage()).toPNG());
            console.log(`captured3d ${capture3dPath}`);
            app.exit(0);
          }, 1500);
        };
        setTimeout(() => void tick(), 400);
      });
    }
  });
  ipcMain.on("view3d:close", () => {
    if (view3dWin && !view3dWin.isDestroyed()) view3dWin.close();
  });
  ipcMain.on("view3d:redock", () => {
    redocking = true;
    if (view3dWin && !view3dWin.isDestroyed()) view3dWin.close();
  });
  ipcMain.on("view3d:ready", () => {
    if (!win.isDestroyed()) win.webContents.send("view3d:child-ready");
  });
  ipcMain.on("view3d:state", (_e, state: unknown) => {
    if (view3dWin && !view3dWin.isDestroyed()) view3dWin.webContents.send("view3d:state", state);
  });

  loadInto(win, query);
});

app.on("window-all-closed", () => app.quit());
