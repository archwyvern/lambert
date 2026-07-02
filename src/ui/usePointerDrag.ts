import { useEffect, useRef } from "react";

/** Window event that aborts any in-flight pointer drag (Esc mid-drag). Drag owners clear their state on
 *  it; the store separately reverts the partial edit via cancelGesture(). */
export const CANCEL_DRAG_EVENT = "lambert-cancel-drag";

/** Screen-px a handle must move before it commits an edit — stops a sub-pixel click-drift on a
 *  vertex/anchor/bezier handle from writing a spurious move + undo entry. */
export const HANDLE_DRAG_PX = 3;

export interface PointerDragHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

export interface PointerDragSpec<S> {
  /** Snapshot the drag's start state. Return null to ignore the press (e.g. not the left button). */
  onStart: (e: React.PointerEvent) => S | null;
  /** Per-move update. `moved` flips true once the pointer passes `threshold` screen px. */
  onMove: (e: React.PointerEvent, start: S, moved: boolean) => void;
  /** Pointer-up (only fires if a drag started). Commit the undo group / clear selection here. */
  onEnd?: (e: React.PointerEvent, start: S, moved: boolean) => void;
  /** Screen-px movement before `moved` flips true (default 0 = moved immediately). */
  threshold?: number;
}

/**
 * The shared pointer-drag lifecycle the gizmos all hand-rolled: pointer-down snapshots start state
 * (and captures the pointer), pointer-move computes against it, pointer-up commits — plus the
 * click-vs-drag `moved` threshold. Call once per handler FAMILY (a fixed number of hook calls);
 * the returned `bind(spec)` produces a handler set, so parameterised handles (each corner / vertex)
 * can share the one drag ref (only one is ever active at a time).
 */
export function usePointerDrag<S>(): (spec: PointerDragSpec<S>) => PointerDragHandlers {
  const ref = useRef<{ start: S; x: number; y: number; moved: boolean } | null>(null);
  // Esc mid-drag: drop the active drag so no further move/up commits. The store reverts the partial edit
  // (cancelGesture); a subsequent pointer-up finds a null ref and no-ops. Capture is released by the OS
  // on pointer-up regardless.
  useEffect(() => {
    const cancel = (): void => {
      ref.current = null;
    };
    window.addEventListener(CANCEL_DRAG_EVENT, cancel);
    return () => window.removeEventListener(CANCEL_DRAG_EVENT, cancel);
  }, []);
  return (spec) => ({
    onPointerDown: (e) => {
      const start = spec.onStart(e);
      if (start === null) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      ref.current = { start, x: e.clientX, y: e.clientY, moved: (spec.threshold ?? 0) <= 0 };
    },
    onPointerMove: (e) => {
      const d = ref.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > (spec.threshold ?? 0)) d.moved = true;
      // Suppress onMove entirely until the threshold is crossed, so a threshold actually prevents a
      // sub-pixel click-drift from writing a move (+ undo entry). No-op for threshold-0 drags, where
      // `moved` starts true. Consumers that hand-roll their own `moved` no longer need to gate it.
      if (d.moved) spec.onMove(e, d.start, d.moved);
    },
    onPointerUp: (e) => {
      const d = ref.current;
      if (!d) return;
      e.stopPropagation();
      ref.current = null;
      spec.onEnd?.(e, d.start, d.moved);
    },
  });
}
