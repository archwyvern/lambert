import type { ProjectConfig } from "./schema";
import type { DocumentStore } from "./store";

/** The fixed project-marker filename. A folder is a Lambert project iff it contains this. */
export const PROJECT_FILE = "project.lambert";

/**
 * One open `.lmb` document. `id` is a stable per-tab key (the React/workspace identity) that survives
 * the untitled→saved transition, so view-state keyed by it doesn't reset on first save. `docPath` is
 * the on-disk path (null until first save). `diffuse.bytes` is the resolved diffuse (file or remote).
 *
 * `diffuse.unresolved` marks a tab restored without its real diffuse — the source failed to resolve
 * (remote host down, file:// on an unmounted drive) so `bytes` is a blank placeholder. The doc/edits
 * are fully intact and preserved in the stash; the user relinks via Reload Diffuse. Export is blocked
 * until then. This replaces the old behaviour of silently dropping such a tab (losing unsaved work).
 */
export interface Tab {
  id: string;
  docPath: string | null;
  store: DocumentStore;
  diffuse: { bytes: Uint8Array; unresolved?: boolean };
}

/**
 * The open workspace: a project's config plus its open document tabs. Each tab carries its own
 * {@link DocumentStore} (independent undo/dirty/selection), and only the active tab is rendered.
 * Framework-agnostic; React binds via useSyncExternalStore.
 */
export class Workspace {
  config: ProjectConfig;
  tabs: Tab[] = [];
  activeIndex = -1;
  private listeners = new Set<() => void>();

  constructor(
    readonly projectPath: string,
    config: ProjectConfig,
  ) {
    this.config = config;
  }

  get active(): Tab | null {
    return this.activeIndex >= 0 ? this.tabs[this.activeIndex]! : null;
  }

  indexById(id: string): number {
    return this.tabs.findIndex((t) => t.id === id);
  }

  /** Index of an open tab by its saved docPath; untitled (null) tabs never match, so they stay distinct. */
  indexByDocPath(docPath: string): number {
    return this.tabs.findIndex((t) => t.docPath === docPath);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Notify subscribers of an in-place change (e.g. a reloaded diffuse) that didn't alter tab structure. */
  notify(): void {
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Open a tab, or focus the existing one if a saved doc with the same docPath is already open. */
  openTab(tab: Tab): void {
    const existing = tab.docPath !== null ? this.indexByDocPath(tab.docPath) : -1;
    if (existing >= 0) {
      this.activeIndex = existing;
    } else {
      this.tabs = [...this.tabs, tab];
      this.activeIndex = this.tabs.length - 1;
    }
    this.emit();
  }

  focus(id: string): void {
    const i = this.indexById(id);
    if (i >= 0 && i !== this.activeIndex) {
      this.activeIndex = i;
      this.emit();
    }
  }

  /** Drag-reorder: move a tab to insertion slot `toIndex` (0..tabs.length, in the CURRENT array).
   *  The active tab stays active (its index follows the move). */
  moveTab(id: string, toIndex: number): void {
    const from = this.indexById(id);
    if (from < 0) return;
    const activeId = this.active?.id ?? null;
    const next = [...this.tabs];
    const [tab] = next.splice(from, 1);
    next.splice(toIndex > from ? toIndex - 1 : toIndex, 0, tab!);
    if (next.every((t, i) => t === this.tabs[i])) return; // no-op move: don't emit
    this.tabs = next;
    if (activeId !== null) this.activeIndex = this.indexById(activeId);
    this.emit();
  }

  /** Close a tab; the active selection moves to the tab that slid into its slot (or the previous). */
  closeTab(id: string): void {
    const i = this.indexById(id);
    if (i < 0) return;
    this.tabs = this.tabs.filter((_, idx) => idx !== i);
    if (this.tabs.length === 0) this.activeIndex = -1;
    else if (i < this.activeIndex) this.activeIndex -= 1;
    else if (i === this.activeIndex) this.activeIndex = Math.min(i, this.tabs.length - 1);
    this.emit();
  }

  setConfig(config: ProjectConfig): void {
    this.config = config;
    this.emit();
  }
}
