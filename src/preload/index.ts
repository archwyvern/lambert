import { contextBridge, ipcRenderer, webUtils } from "electron";
import os from "node:os";
import { exposeFs, exposeOs } from "@carapace/shell/ipc";

contextBridge.exposeInMainWorld("lambertHost", {
  // filesystem path for a DataTransfer File (drag-drop) — File.path is gone in modern Electron
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  // runtime versions + OS for the About dialog's diagnostics block (preload has process access)
  diagnostics: () => ({
    electron: process.versions.electron ?? "?",
    chromium: process.versions.chrome ?? "?",
    node: process.versions.node ?? "?",
    v8: process.versions.v8 ?? "?",
    os: `${os.type()} ${os.release()} (${process.arch})`,
  }),
  sendSelftestResult: (report: unknown) => ipcRenderer.send("selftest-result", report),
  openDialog: (opts: unknown) => ipcRenderer.invoke("dialog:open", opts),
  saveDialog: (opts: unknown) => ipcRenderer.invoke("dialog:save", opts),
  readFile: (path: string) => ipcRenderer.invoke("fs:read", path),
  writeFile: (path: string, data: Uint8Array) => ipcRenderer.invoke("fs:write", path, data),
  fetchUrl: (url: string, opts?: { refresh?: boolean }) => ipcRenderer.invoke("net:fetchUrl", url, opts),
  openFolderDialog: (opts: unknown) => ipcRenderer.invoke("dialog:openFolder", opts),
  pathExists: (path: string) => ipcRenderer.invoke("fs:exists", path),
  gitStatus: (dir: string) => ipcRenderer.invoke("git:status", dir),
  mkdir: (path: string) => ipcRenderer.invoke("fs:mkdir", path),
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  windowIsMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  loadSession: () => ipcRenderer.invoke("session:load"),
  saveSession: (json: string) => ipcRenderer.invoke("session:save", json),
  onMenuAction: (cb: (action: string) => void) =>
    ipcRenderer.on("menu:action", (_e, action: string) => cb(action)),
  setMenuAccelerators: (map: Record<string, string | null>) => ipcRenderer.invoke("menu:accelerators", map),
  notifyProjectOpened: () => ipcRenderer.send("window:enter-project"),
  onOpenProjectPath: (cb: (dir: string) => void) =>
    ipcRenderer.on("open-project-path", (_e, dir: string) => cb(dir)),
  takePendingOpen: () => ipcRenderer.invoke("project:take-pending-open"),
  guardClose: () => ipcRenderer.send("guard-close"),
  onConfirmClose: (cb: () => void) => ipcRenderer.on("confirm-close", cb),
  respondClose: (ok: boolean) => ipcRenderer.send("close-response", ok),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  quitAndInstall: () => ipcRenderer.invoke("update:install"),
  onUpdateEvent: (cb: (ev: unknown) => void) =>
    ipcRenderer.on("update:event", (_e, ev: unknown) => cb(ev)),
});

// carapace fs + os bridges (window.carapaceFs / carapaceOs) for the shared <FileExplorer>
exposeFs(contextBridge, ipcRenderer);
exposeOs(contextBridge, ipcRenderer);
