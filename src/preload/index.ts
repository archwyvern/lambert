import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("flatlandHost", {
  sendSelftestResult: (report: unknown) => ipcRenderer.send("selftest-result", report),
  openDialog: (opts: unknown) => ipcRenderer.invoke("dialog:open", opts),
  saveDialog: (opts: unknown) => ipcRenderer.invoke("dialog:save", opts),
  readFile: (path: string) => ipcRenderer.invoke("fs:read", path),
  writeFile: (path: string, data: Uint8Array) => ipcRenderer.invoke("fs:write", path, data),
  guardClose: () => ipcRenderer.send("guard-close"),
  onConfirmClose: (cb: () => void) => ipcRenderer.on("confirm-close", cb),
  respondClose: (ok: boolean) => ipcRenderer.send("close-response", ok),
});
