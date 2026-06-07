import type { View3DState } from "./view3d";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Host {
  openDialog(opts: { title: string; filters: FileFilter[] }): Promise<string | null>;
  saveDialog(opts: { title: string; defaultPath?: string; filters: FileFilter[] }): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Session memory in Electron userData; null when no prior session exists. */
  loadSession(): Promise<string | null>;
  saveSession(json: string): Promise<void>;
  /** Application-menu actions (open-image/save/export-nx/undo/zoom-fit/...). */
  onMenuAction(cb: (action: string) => void): void;
  /** Tell main this window has a close guard; close events then ask before closing. */
  guardClose(): void;
  onConfirmClose(cb: () => void): void;
  respondClose(ok: boolean): void;

  // 3D pop-out window (main-window side)
  openView3d(): void;
  closeView3d(): void;
  sendView3dState(state: View3DState): void;
  /** Child window mounted and wants the current state; returns an unsubscribe fn. */
  onView3dChildReady(cb: () => void): () => void;
  /** Child window was closed (X); returns an unsubscribe fn. */
  onView3dClosed(cb: () => void): () => void;
  /** Child window requested a redock; returns an unsubscribe fn. */
  onView3dRedocked(cb: () => void): () => void;

  // 3D pop-out window (child-window side)
  view3dReady(): void;
  redockView3d(): void;
  onView3dState(cb: (state: View3DState) => void): () => void;
}

interface HostWindow {
  flatlandHost: Host & { sendSelftestResult(report: unknown): void };
}

export function getHost(): Host {
  return (window as unknown as HostWindow).flatlandHost;
}
