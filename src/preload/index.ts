import { contextBridge, ipcRenderer } from "electron";
import { exposeFs } from "@carapace/shell/ipc";

contextBridge.exposeInMainWorld("lambertHost", {
  sendSelftestResult: (report: unknown) => ipcRenderer.send("selftest-result", report),
  openDialog: (opts: unknown) => ipcRenderer.invoke("dialog:open", opts),
  saveDialog: (opts: unknown) => ipcRenderer.invoke("dialog:save", opts),
  readFile: (path: string) => ipcRenderer.invoke("fs:read", path),
  writeFile: (path: string, data: Uint8Array) => ipcRenderer.invoke("fs:write", path, data),
  openFolderDialog: (opts: unknown) => ipcRenderer.invoke("dialog:openFolder", opts),
  pathExists: (path: string) => ipcRenderer.invoke("fs:exists", path),
  loadSession: () => ipcRenderer.invoke("session:load"),
  saveSession: (json: string) => ipcRenderer.invoke("session:save", json),
  onMenuAction: (cb: (action: string) => void) =>
    ipcRenderer.on("menu:action", (_e, action: string) => cb(action)),
  guardClose: () => ipcRenderer.send("guard-close"),
  onConfirmClose: (cb: () => void) => ipcRenderer.on("confirm-close", cb),
  respondClose: (ok: boolean) => ipcRenderer.send("close-response", ok),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  quitAndInstall: () => ipcRenderer.invoke("update:install"),
  onUpdateEvent: (cb: (ev: unknown) => void) =>
    ipcRenderer.on("update:event", (_e, ev: unknown) => cb(ev)),
});

// carapace fs bridge (window.carapaceFs) for the shared <FileExplorer>
exposeFs(contextBridge, ipcRenderer);
