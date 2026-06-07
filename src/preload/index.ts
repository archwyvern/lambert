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

  // 3D pop-out window. Main-window side: open/close/push-state + closed/redocked/ready hooks.
  openView3d: () => ipcRenderer.send("view3d:open"),
  closeView3d: () => ipcRenderer.send("view3d:close"),
  sendView3dState: (state: unknown) => ipcRenderer.send("view3d:state", state),
  onView3dChildReady: (cb: () => void) => {
    const h = (): void => cb();
    ipcRenderer.on("view3d:child-ready", h);
    return () => ipcRenderer.removeListener("view3d:child-ready", h);
  },
  onView3dClosed: (cb: () => void) => {
    const h = (): void => cb();
    ipcRenderer.on("view3d:closed", h);
    return () => ipcRenderer.removeListener("view3d:closed", h);
  },
  onView3dRedocked: (cb: () => void) => {
    const h = (): void => cb();
    ipcRenderer.on("view3d:redocked", h);
    return () => ipcRenderer.removeListener("view3d:redocked", h);
  },
  // child-window side: signal ready, receive state pushes, request a redock.
  view3dReady: () => ipcRenderer.send("view3d:ready"),
  redockView3d: () => ipcRenderer.send("view3d:redock"),
  onView3dState: (cb: (state: unknown) => void) => {
    const h = (_e: unknown, state: unknown): void => cb(state);
    ipcRenderer.on("view3d:state", h);
    return () => ipcRenderer.removeListener("view3d:state", h);
  },
});
