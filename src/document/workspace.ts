import type { ProjectConfig } from "./schema";
import type { DocumentStore } from "./store";

/** The fixed project-marker filename. A folder is a Lambert project iff it contains this. */
export const PROJECT_FILE = "project.lambert";

/** One open image: its diffuse, its sidecar doc store, and where that sidecar lives (null = unsaved). */
export interface Tab {
  imagePath: string;
  docPath: string | null;
  store: DocumentStore;
  diffuse: { bytes: Uint8Array; dir: string };
}

const STEM = /(\.df)?\.png$/i;
const stemOf = (imagePath: string): string => imagePath.replace(STEM, "");

/** The `.lnb` sidecar path for an image (drops a `.df.png` / `.png` suffix). */
export const sidecarPath = (imagePath: string): string => stemOf(imagePath) + ".lnb";

/** Candidate sidecar paths in priority order: new `.lnb`, then legacy `.lambert` / `.flatland`. */
export const legacySidecarCandidates = (imagePath: string): string[] => {
  const s = stemOf(imagePath);
  return [s + ".lnb", s + ".lambert", s + ".flatland"];
};

/**
 * The open workspace: a project's config plus its open image tabs. Replaces the single-document
 * store; each tab carries its own {@link DocumentStore} (independent undo/dirty/selection), and
 * only the active tab is rendered. Framework-agnostic; React binds via useSyncExternalStore.
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

  indexOf(imagePath: string): number {
    return this.tabs.findIndex((t) => t.imagePath === imagePath);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Open a tab, or focus the existing one if its image is already open. */
  openTab(tab: Tab): void {
    const existing = this.indexOf(tab.imagePath);
    if (existing >= 0) {
      this.activeIndex = existing;
    } else {
      this.tabs = [...this.tabs, tab];
      this.activeIndex = this.tabs.length - 1;
    }
    this.emit();
  }

  focus(imagePath: string): void {
    const i = this.indexOf(imagePath);
    if (i >= 0 && i !== this.activeIndex) {
      this.activeIndex = i;
      this.emit();
    }
  }

  /** Close a tab; the active selection moves to the tab that slid into its slot (or the previous). */
  closeTab(imagePath: string): void {
    const i = this.indexOf(imagePath);
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
