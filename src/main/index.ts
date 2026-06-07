import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

  const win = new BrowserWindow({
    width: 1100,
    height: 640,
    show: !selftest,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      // electron-vite emits the preload as ESM (.mjs); Electron only loads ESM preloads
      // with the renderer sandbox off. contextIsolation stays on.
      sandbox: false,
    },
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
    // screenshot the window after it settles, write PNG, exit — automated visual checks
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        const { writeFileSync } = await import("node:fs");
        writeFileSync(capturePath, image.toPNG());
        console.log(`captured ${capturePath}`);
        app.exit(0);
      }, 3000);
    });
  }

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  const query = selftest ? "?selftest=1" : extraQuery ? `?${extraQuery}` : "";
  if (devUrl) {
    void win.loadURL(devUrl + query);
  } else {
    void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"), {
      search: query,
    });
  }
});

app.on("window-all-closed", () => app.quit());
