import { contextBridge, ipcRenderer, webUtils } from "electron";
import os from "node:os";
import { exposeFs, exposeOs } from "@carapace/shell/ipc";

// Spawned-window pref seeding: "open in new window" runs this instance on a fresh disposable
// profile, so the parent snapshots its localStorage prefs into the profile and we replay them here
// — before any renderer code reads them. The sentinel keeps a reloaded window from re-seeding over
// prefs the user has since changed. Normal launches get null and skip all of this.
try {
  const seed = ipcRenderer.sendSync("session:spawn-seed") as string | null;
  if (seed !== null && localStorage.getItem("lambert:__seeded") === null) {
    for (const [k, v] of Object.entries(JSON.parse(seed) as Record<string, string>)) localStorage.setItem(k, v);
    localStorage.setItem("lambert:__seeded", "1");
  }
} catch {
  // unreadable/malformed seed: the window simply runs with default prefs
}

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
  rename: (from: string, to: string) => ipcRenderer.invoke("fs:rename", from, to),
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
  revealPath: (path: string) => ipcRenderer.invoke("path:reveal", path),
  onMenuAction: (cb: (action: string) => void) =>
    ipcRenderer.on("menu:action", (_e, action: string) => cb(action)),
  setMenuAccelerators: (map: Record<string, string | null>) => ipcRenderer.invoke("menu:accelerators", map),
  notifyProjectOpened: () => ipcRenderer.send("window:enter-project"),
  openInNewWindow: (dir: string, prefsJson: string) => ipcRenderer.invoke("window:openNew", dir, prefsJson),
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
