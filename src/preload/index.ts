import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("flatlandHost", {
  sendSelftestResult: (report: unknown) => ipcRenderer.send("selftest-result", report),
  openDialog: (opts: unknown) => ipcRenderer.invoke("dialog:open", opts),
  saveDialog: (opts: unknown) => ipcRenderer.invoke("dialog:save", opts),
  readFile: (path: string) => ipcRenderer.invoke("fs:read", path),
  writeFile: (path: string, data: Uint8Array) => ipcRenderer.invoke("fs:write", path, data),
  loadSession: () => ipcRenderer.invoke("session:load"),
  saveSession: (json: string) => ipcRenderer.invoke("session:save", json),
  onMenuAction: (cb: (action: string) => void) =>
    ipcRenderer.on("menu:action", (_e, action: string) => cb(action)),
  guardClose: () => ipcRenderer.send("guard-close"),
  onConfirmClose: (cb: () => void) => ipcRenderer.on("confirm-close", cb),
  respondClose: (ok: boolean) => ipcRenderer.send("close-response", ok),
});
