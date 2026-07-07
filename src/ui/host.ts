import { createIpcFs } from "@carapace/shell";
import { createIpcOs, type OsBridge } from "@carapace/shell/ipc";
import type { CarapaceHost, FsBridge } from "@carapace/shell";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

export interface DiagnosticsInfo {
  electron: string;
  chromium: string;
  node: string;
  v8: string;
  os: string;
}

export interface Host {
  /** Runtime versions + OS string for the About dialog (synchronous — read in the preload). */
  diagnostics(): DiagnosticsInfo;
  /** Filesystem path of a drag-dropped File (webUtils.getPathForFile); null if unavailable. */
  pathForFile(file: File): string | null;
  openDialog(opts: { title: string; filters: FileFilter[] }): Promise<string | null>;
  saveDialog(opts: { title: string; defaultPath?: string; filters: FileFilter[] }): Promise<string | null>;
  /** Folder picker (project open/new); defaultPath reopens the dialog at the last-used directory. */
  openFolderDialog(opts: { title: string; defaultPath?: string }): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Fetch a remote diffuse (main-process fetch, no renderer CORS/CSP), cached in userData by URL hash.
   *  refresh bypasses the cache. Throws if offline with no cached copy. */
  fetchUrl(url: string, opts?: { refresh?: boolean }): Promise<Uint8Array>;
  /** Whether a path exists (project-marker / file checks). */
  pathExists(path: string): Promise<boolean>;
  /** Raw `git status --porcelain=v1 -z` stdout for a dir ("" when not a repo / git absent). */
  gitStatus(dir: string): Promise<string>;
  /** Create a directory (recursive; no error if it already exists). */
  mkdir(path: string): Promise<void>;
  /** Frameless-window controls (the carapace TopBar renders the buttons). */
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<void>;
  windowClose(): Promise<void>;
  windowIsMaximized(): Promise<boolean>;
  /** Session memory in Electron userData; null when no prior session exists. */
  loadSession(): Promise<string | null>;
  saveSession(json: string): Promise<void>;
  /** Highlight a file in the OS file manager ("Open Containing Folder"). */
  revealPath(path: string): Promise<void>;
  /** Application-menu actions (open-image/save/export-nx/undo/zoom-fit/...). */
  onMenuAction(cb: (action: string) => void): void;
  /** Push the effective command bindings; main rebuilds the native menu so accelerators track rebinds. */
  setMenuAccelerators(map: Record<string, string | null>): Promise<void>;
  /** Tell main a project opened, so it can grow the compact welcome window to the remembered editor size. */
  notifyProjectOpened(): void;
  /** A project folder the OS asked us to open while running (double-clicked project.lambert). */
  onOpenProjectPath(cb: (dir: string) => void): void;
  /** Pull (once, on mount) any project folder the OS asked us to open at launch; null if none. */
  takePendingOpen(): Promise<string | null>;
  /** Tell main this window has a close guard; close events then ask before closing. */
  guardClose(): void;
  onConfirmClose(cb: () => void): void;
  respondClose(ok: boolean): void;
  /** Autoupdate (Windows NSIS + Linux AppImage). No-op offers in dev / unsupported platforms. */
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): Promise<void>;
  onUpdateEvent(cb: (ev: UpdateEvent) => void): void;
}

interface HostWindow {
  lambertHost: Host & { sendSelftestResult(report: unknown): void };
  carapaceFs: FsBridge;
  carapaceOs: OsBridge;
}

export function getHost(): Host {
  return (window as unknown as HostWindow).lambertHost;
}

/**
 * The carapace host seam, consumed by the shared <FileExplorer> and TopBar WindowControls via
 * <HostProvider>. `fs` (the project file tree) and `window` (frameless-window controls) are real;
 * dialog/clipboard stay stubs Lambert doesn't use through carapace (it has its own dialogs + IO
 * via lambertHost).
 */
export const carapaceHost: CarapaceHost = {
  window: {
    minimize: () => void getHost().windowMinimize(),
    toggleMaximize: () => getHost().windowToggleMaximize(),
    close: () => void getHost().windowClose(),
    isMaximized: () => getHost().windowIsMaximized(),
    onMaximizeChanged: () => () => {},
  },
  fs: createIpcFs((window as unknown as HostWindow).carapaceFs),
  os: createIpcOs((window as unknown as HostWindow).carapaceOs),
  dialog: {
    openFile: () => Promise.resolve(null),
    saveFile: () => Promise.resolve(null),
    message: () => Promise.resolve(),
  },
  clipboard: {
    writeText: (text) => navigator.clipboard.writeText(text),
    readText: () => navigator.clipboard.readText(),
  },
};
