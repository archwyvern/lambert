import { createIpcFs } from "@carapace/shell";
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

export interface Host {
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
  /** Session memory in Electron userData; null when no prior session exists. */
  loadSession(): Promise<string | null>;
  saveSession(json: string): Promise<void>;
  /** Application-menu actions (open-image/save/export-nx/undo/zoom-fit/...). */
  onMenuAction(cb: (action: string) => void): void;
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
}

export function getHost(): Host {
  return (window as unknown as HostWindow).lambertHost;
}

/**
 * The carapace host seam, consumed by the shared <FileExplorer> via <HostProvider>. Only the
 * `fs` adapter is real (the project file tree); window/dialog/clipboard are stubs Lambert
 * doesn't use through carapace (it has its own menu, dialogs, and IO via lambertHost).
 */
export const carapaceHost: CarapaceHost = {
  window: {
    minimize: () => {},
    toggleMaximize: () => Promise.resolve(),
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChanged: () => () => {},
  },
  fs: createIpcFs((window as unknown as HostWindow).carapaceFs),
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
