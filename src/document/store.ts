import { findNode } from "./layerOps";
import type { LambertDoc } from "./schema";

export interface EditorState {
  doc: LambertDoc;
  /** Multi-selection in pick order; the LAST entry is the "primary". Empty = nothing selected. */
  selectedIds: string[];
  /** Derived convenience: the primary (last of selectedIds), or null. Single-select readers use this. */
  selectedId: string | null;
  dirty: boolean;
  docPath: string | null;
}

const sameIds = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Build the paired selection fields (the array + its derived primary). */
const sel = (ids: string[]): { selectedIds: string[]; selectedId: string | null } => ({
  selectedIds: ids,
  selectedId: ids.length ? ids[ids.length - 1]! : null,
});

export interface UpdateOptions {
  /** Consecutive updates with the same key merge into one undo entry until endGesture(). */
  coalesce?: string;
}

/** Snapshot-undo document store. Framework-agnostic; React binds via useSyncExternalStore. */
export class DocumentStore {
  private listeners = new Set<() => void>();
  private undoStack: LambertDoc[] = [];
  private redoStack: LambertDoc[] = [];
  private gestureKey: string | null = null;
  private current: EditorState;
  // the doc reference at the last save/load; dirty is `current.doc !== savedDoc`, so undoing all the
  // way back to the saved content clears the dirty flag instead of leaving a false "unsaved" badge.
  private savedDoc: LambertDoc | null;

  constructor(doc: LambertDoc, docPath: string | null) {
    this.current = { doc, ...sel([]), dirty: false, docPath };
    this.savedDoc = doc;
  }

  get state(): EditorState {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(next: Partial<EditorState>): void {
    this.current = { ...this.current, ...next };
    for (const fn of this.listeners) fn();
  }

  private survivingSelection(doc: LambertDoc): { selectedIds: string[]; selectedId: string | null } {
    return sel(this.current.selectedIds.filter((id) => findNode(doc.layers, id)));
  }

  update(mutate: (doc: LambertDoc) => LambertDoc, opts: UpdateOptions = {}): void {
    const prev = this.current.doc;
    const next = mutate(prev);
    if (next === prev) return;
    const key = opts.coalesce ?? null;
    if (!(key !== null && key === this.gestureKey)) {
      this.undoStack.push(prev);
      this.redoStack = [];
    }
    this.gestureKey = key;
    this.emit({ doc: next, dirty: next !== this.savedDoc, ...this.survivingSelection(next) });
  }

  endGesture(): void {
    this.gestureKey = null;
  }

  /** One-shot edit: update + endGesture. The standard form for click-driven (non-drag) mutations —
   *  menu verbs, toggles, inserts. Drags keep using update({coalesce}) + endGesture on release. */
  commit(mutate: (doc: LambertDoc) => LambertDoc): void {
    this.update(mutate);
    this.endGesture();
  }

  /** True while a coalesced gesture (drag) is in progress — its first update already pushed the
   *  pre-gesture doc onto the undo stack, but endGesture hasn't run. */
  get isGesturing(): boolean {
    return this.gestureKey !== null;
  }

  /** Abort the in-flight gesture, reverting to the pre-gesture document (Esc mid-drag). Unlike undo(),
   *  it DISCARDS the gesture: it pops the pre-gesture snapshot the gesture pushed and creates no redo
   *  entry, so a cancelled drag leaves the history exactly as it was before the drag began. */
  cancelGesture(): void {
    if (this.gestureKey === null) return;
    const prev = this.undoStack.pop(); // the pre-gesture doc pushed by the gesture's first update
    this.gestureKey = null;
    if (prev === undefined) return;
    this.emit({ doc: prev, dirty: prev !== this.savedDoc, ...this.survivingSelection(prev) });
  }

  /** Replace the selection with a single id (or clear it). */
  select(id: string | null): void {
    this.setSelection(id === null ? [] : [id]);
  }

  /** Add the id if absent, remove it if present (Ctrl/Cmd-click). */
  toggleSelect(id: string): void {
    const cur = this.current.selectedIds;
    this.setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  /** Replace the whole selection. */
  setSelection(ids: string[]): void {
    if (sameIds(ids, this.current.selectedIds)) return;
    this.emit(sel(ids));
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.gestureKey = null;
    this.redoStack.push(this.current.doc);
    this.emit({ doc: prev, dirty: prev !== this.savedDoc, ...this.survivingSelection(prev) });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.gestureKey = null;
    this.undoStack.push(this.current.doc);
    this.emit({ doc: next, dirty: next !== this.savedDoc, ...this.survivingSelection(next) });
  }

  /** Replace the whole document (open/new/session-restore). Clears history. */
  reset(doc: LambertDoc, docPath: string | null, opts: { dirty?: boolean } = {}): void {
    this.undoStack = [];
    this.redoStack = [];
    this.gestureKey = null;
    // a clean load makes `doc` the saved baseline; a dirty restore has no on-disk baseline (stays dirty)
    this.savedDoc = opts.dirty ? null : doc;
    this.emit({ doc, docPath, dirty: opts.dirty ?? false, ...sel([]) });
  }

  /** Mark a SPECIFIC doc snapshot as the saved baseline — not necessarily `current`, because an edit
   *  may have landed during the async file write. dirty is recomputed against the live doc, so if
   *  the user edited mid-save the flag correctly stays true (the newer doc wasn't persisted). */
  markSaved(doc: LambertDoc, path: string): void {
    this.savedDoc = doc;
    this.emit({ dirty: this.current.doc !== doc, docPath: path });
  }

  /** Update the on-disk path without touching dirty/undo — the file was renamed/moved underneath us. */
  setDocPath(path: string): void {
    this.emit({ docPath: path });
  }
}
