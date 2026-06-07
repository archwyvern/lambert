import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("flatlandHost", {
  sendSelftestResult: (report: unknown) => ipcRenderer.send("selftest-result", report),
});
