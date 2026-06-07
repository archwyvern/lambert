import type { FlatlandDoc } from "./schema";

export interface EditorState {
  doc: FlatlandDoc;
  selectedId: string | null;
  dirty: boolean;
  docPath: string | null;
}

export interface UpdateOptions {
  /** Consecutive updates with the same key merge into one undo entry until endGesture(). */
  coalesce?: string;
}

/** Snapshot-undo document store. Framework-agnostic; React binds via useSyncExternalStore. */
export class DocumentStore {
  private listeners = new Set<() => void>();
  private undoStack: FlatlandDoc[] = [];
  private redoStack: FlatlandDoc[] = [];
  private gestureKey: string | null = null;
  private current: EditorState;

  constructor(doc: FlatlandDoc, docPath: string | null) {
    this.current = { doc, selectedId: null, dirty: false, docPath };
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

  private survivingSelection(doc: FlatlandDoc): string | null {
    const id = this.current.selectedId;
    return id && doc.shapes.some((s) => s.id === id) ? id : null;
  }

  update(mutate: (doc: FlatlandDoc) => FlatlandDoc, opts: UpdateOptions = {}): void {
    const prev = this.current.doc;
    const next = mutate(prev);
    if (next === prev) return;
    const key = opts.coalesce ?? null;
    if (!(key !== null && key === this.gestureKey)) {
      this.undoStack.push(prev);
      this.redoStack = [];
    }
    this.gestureKey = key;
    this.emit({ doc: next, dirty: true, selectedId: this.survivingSelection(next) });
  }

  endGesture(): void {
    this.gestureKey = null;
  }

  select(id: string | null): void {
    if (id === this.current.selectedId) return;
    this.emit({ selectedId: id });
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.gestureKey = null;
    this.redoStack.push(this.current.doc);
    this.emit({ doc: prev, dirty: true, selectedId: this.survivingSelection(prev) });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.gestureKey = null;
    this.undoStack.push(this.current.doc);
    this.emit({ doc: next, dirty: true, selectedId: this.survivingSelection(next) });
  }

  /** Replace the whole document (open/new). Clears history. */
  reset(doc: FlatlandDoc, docPath: string | null): void {
    this.undoStack = [];
    this.redoStack = [];
    this.gestureKey = null;
    this.emit({ doc, docPath, dirty: false, selectedId: null });
  }

  markSaved(path: string): void {
    this.emit({ dirty: false, docPath: path });
  }
}
