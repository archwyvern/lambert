import { useEffect } from "react";
import { removeObject, removeObjectVertices, updateObject } from "../document/docOps";
import { findNode } from "../document/layerOps";
import { isObject } from "../field/types";
import { v2 } from "../field/vec";
import type { Workspace } from "../document/workspace";
import type { ViewState } from "./App";
import { CANCEL_DRAG_EVENT } from "./usePointerDrag";
import { VIEW_MODES } from "./preview";
import { TOOL_KEYS, ToolMode } from "./tools";

/**
 * The window-level editor keymap (QC-CARRY-2 extraction from App). File/undo accelerators live in the
 * application menu; this owns everything else: Ctrl+Shift+Z redo, Ctrl+C/V object copy/paste, Space
 * swallow (hold-to-pan), X view swap, Esc (drag-cancel/deselect), QWERT+PM tool keys, Delete (anchors →
 * vertices → layers), V view-mode cycle, and arrow nudges (coalesced into one undo entry per burst).
 * Everything comes in through refs/setState so the single mount-time listener never goes stale.
 */
export function useEditorKeymap(opts: {
  workspaceRef: React.RefObject<Workspace | null>;
  runMenuActionRef: React.RefObject<(action: string) => void>;
  selVertsRef: React.RefObject<number[]>;
  nudgeEndTimer: React.RefObject<ReturnType<typeof setTimeout> | null>;
  setSwapped: (fn: (sw: boolean) => boolean) => void;
  setSelVerts: (v: number[]) => void;
  setTool: (t: ToolMode) => void;
  setActiveView: (fn: (v: ViewState) => ViewState) => void;
}): void {
  const { workspaceRef, runMenuActionRef, selVertsRef, nudgeEndTimer, setSwapped, setSelVerts, setTool, setActiveView } = opts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tgt = e.target;
      if (
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLSelectElement ||
        tgt instanceof HTMLTextAreaElement ||
        (tgt instanceof HTMLElement && tgt.isContentEditable)
      )
        return;
      // Ctrl/Cmd+Shift+Z = redo (Photoshop-style), in addition to the menu's Ctrl+Y. Handled here, not
      // in the menu, because a MenuItem takes a single accelerator; this combo isn't a menu accelerator
      // so there's no double-fire with the menu-owned Ctrl+Z/Ctrl+Y.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        workspaceRef.current?.active?.store.redo();
        return;
      }
      // Object copy/paste. Handled here (not as a menu accelerator) and only when focus is NOT in a text
      // field (guarded at the top of onKey) — so Ctrl+C/V still does native text copy/paste in inputs.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v")) {
        e.preventDefault();
        runMenuActionRef.current(e.key.toLowerCase() === "c" ? "copy" : "paste");
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Space is the hold-to-pan modifier (CanvasView tracks its own keydown/keyup); swallow it here so
      // it never scrolls the page or triggers a focused button. View swap moved to X (QC-INT-11 — V
      // already cycles Diffuse/Normal/Lit).
      if (e.code === "Space") {
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === "x") {
        setSwapped((sw) => !sw);
        return;
      }
      const t = workspaceRef.current?.active;
      if (!t) return;
      const store = t.store;
      if (e.key === "Escape") {
        // Esc aborts an in-flight drag (revert the partial transform); otherwise it deselects. The cancel
        // event drops each drag owner's state so nothing further commits, and cancelGesture reverts the
        // doc + discards the open undo entry. A plain empty-canvas click only clears the vertex selection
        // (see CanvasView endDrag) — deselecting the whole object is Esc's job.
        window.dispatchEvent(new Event(CANCEL_DRAG_EVENT));
        if (store.isGesturing) {
          store.cancelGesture();
        } else {
          setSelVerts([]);
          store.select(null);
        }
        return;
      }
      if (store.isGesturing) return; // mid-drag: ignore tool/edit keys (only Esc, above, acts)
      const id = store.state.selectedId;
      const key = e.key.toLowerCase();
      if (key in TOOL_KEYS) {
        setTool(TOOL_KEYS[key]!);
      } else if ((e.key === "Delete" || e.key === "Backspace") && id) {
        const node = findNode(store.state.doc.layers, id);
        const object = node && isObject(node) ? node : null;
        const verts = selVertsRef.current;
        if (object?.bezier && verts.length > 0) {
          // delete the selected cable anchor(s) — never below the 2-anchor minimum (don't nuke the cable)
          if (object.bezier.length - verts.length >= 2) {
            store.update((d) =>
              updateObject(d, id, (s) => ({ ...s, bezier: s.bezier?.filter((_, i) => !verts.includes(i)) })),
            );
            setSelVerts([]);
          }
        } else if (object && verts.length > 0 && object.controlPoints.length > 0) {
          // delete selected vertices (mesh / polygon / polyline / ring), guarded per kind
          store.update((d) => updateObject(d, id, (s) => removeObjectVertices(s, verts)));
          setSelVerts([]);
        } else {
          // no vertex sub-selection: delete every selected layer
          const sel = store.state.selectedIds;
          store.update((d) => sel.reduce((acc, sid) => removeObject(acc, sid), d));
        }
        store.endGesture();
      } else if (key === "v") {
        setActiveView((s) => ({ ...s, mode: VIEW_MODES[(VIEW_MODES.indexOf(s.mode) + 1) % VIEW_MODES.length]! }));
      } else if (e.key.startsWith("Arrow") && id) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const node = findNode(store.state.doc.layers, id);
        const object = node && isObject(node) ? node : null;
        const verts = selVertsRef.current;
        if (object?.bezier && verts.length > 0) {
          // nudge selected cable anchors (move the point; handles are offsets and follow)
          store.update(
            (d) =>
              updateObject(d, id, (s) => ({
                ...s,
                bezier: s.bezier?.map((a, i) => (verts.includes(i) ? { ...a, p: v2(a.p.x + dx, a.p.y + dy) } : a)),
              })),
            { coalesce: `vnudge:${id}` },
          );
        } else if (object && verts.length > 0 && object.controlPoints.length > 0) {
          // nudge selected control-point vertices (polygon / polyline / ring / mesh)
          store.update(
            (d) =>
              updateObject(d, id, (s) => ({
                ...s,
                controlPoints: s.controlPoints.map((p, i) => (verts.includes(i) ? v2(p.x + dx, p.y + dy) : p)),
              })),
            { coalesce: `vnudge:${id}` },
          );
        } else {
          store.update(
            (d) =>
              updateObject(d, id, (s) => ({
                ...s,
                transform: { ...s.transform, pos: s.transform.pos.withX(s.transform.pos.x + dx).withY(s.transform.pos.y + dy) },
              })),
            { coalesce: `nudge:${id}` },
          );
        }
        // a burst of nudges collapses to one undo entry; commit it after a short pause so the next
        // edit (or a later nudge after thinking) is its own undo step.
        if (nudgeEndTimer.current) clearTimeout(nudgeEndTimer.current);
        nudgeEndTimer.current = setTimeout(() => store.endGesture(), 500);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
