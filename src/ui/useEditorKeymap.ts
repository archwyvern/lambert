import { useEffect } from "react";
import { matchEvent, parseChord } from "@carapace/shell";
import type { Chord } from "@carapace/shell";
import { removeObject, removeObjectVertices, updateObject } from "../document/docOps";
import { findNode, updateNode } from "../document/layerOps";
import { applyBezierEdit } from "../field/bezierEdit";
import { isObject } from "../field/types";
import { v2 } from "../field/vec";
import type { Workspace } from "../document/workspace";
import type { ViewState } from "./App";
import { CANCEL_DRAG_EVENT } from "./usePointerDrag";
import { VIEW_MODES } from "./preview";
import type { ToolMode } from "./tools";

/** An editor-scope command with its effective chord parsed, ready to match keydowns. */
export interface EditorBinding {
  id: string;
  chord: Chord;
}

/**
 * The window-level editor keymap. Editor-scope commands (tools, view cycle/swap, copy/paste,
 * delete, and anything the user binds) match through the REBINDABLE chord list (bindingsRef,
 * derived from the command model + user overrides); what stays hardcoded is the modal, non-command
 * layer: Ctrl+Shift+Z as a redo alias, Space swallow (hold-to-pan), Esc (drag-cancel/deselect),
 * Backspace as a Delete alias, and arrow nudges (coalesced into one undo entry per burst).
 * Everything comes in through refs/setState so the single mount-time listener never goes stale.
 */
export function useEditorKeymap(opts: {
  workspaceRef: React.RefObject<Workspace | null>;
  runMenuActionRef: React.RefObject<(action: string) => void>;
  /** Editor-scope commands with effective chords (rebind-aware). */
  bindingsRef: React.RefObject<EditorBinding[]>;
  selVertsRef: React.RefObject<number[]>;
  nudgeEndTimer: React.RefObject<ReturnType<typeof setTimeout> | null>;
  setSwapped: (fn: (sw: boolean) => boolean) => void;
  setSelVerts: (v: number[]) => void;
  setTool: (t: ToolMode) => void;
  setActiveView: (fn: (v: ViewState) => ViewState) => void;
}): void {
  const { workspaceRef, runMenuActionRef, bindingsRef, selVertsRef, nudgeEndTimer, setSwapped, setSelVerts, setTool, setActiveView } = opts;
  useEffect(() => {
    // the modal Delete: selected anchors -> selected vertices -> selected layers
    const deleteSelection = (): void => {
      const t = workspaceRef.current?.active;
      if (!t) return;
      const store = t.store;
      if (store.state.selectedIds.length === 0) return; // nothing selected: no phantom undo entry
      const id = store.state.selectedId;
      const node = id ? findNode(store.state.doc.layers, id) : null;
      const object = node && isObject(node) ? node : null;
      const verts = selVertsRef.current;
      if (id && object?.bezier && verts.length > 0) {
        // delete the selected cable anchor(s) — never below the 2-anchor minimum (don't nuke the cable)
        if (object.bezier.length - verts.length >= 2) {
          store.update((d) =>
            updateObject(d, id, (s) => ({ ...s, bezier: s.bezier?.filter((_, i) => !verts.includes(i)) })),
          );
          setSelVerts([]);
        }
      } else if (id && object && verts.length > 0 && object.controlPoints.length > 0) {
        // delete selected vertices (mesh / polygon / polyline / ring), guarded per kind
        store.update((d) => updateObject(d, id, (s) => removeObjectVertices(s, verts)));
        setSelVerts([]);
      } else {
        // no vertex sub-selection: delete every selected layer
        const sel = store.state.selectedIds;
        store.update((d) => sel.reduce((acc, sid) => removeObject(acc, sid), d));
      }
      store.endGesture();
    };

    // rebindable editor commands land here after their chord matches
    const runEditorCommand = (id: string): void => {
      if (id.startsWith("tool-")) {
        setTool(id.slice("tool-".length) as ToolMode);
      } else if (id === "view-cycle") {
        setActiveView((s) => ({ ...s, mode: VIEW_MODES[(VIEW_MODES.indexOf(s.mode) + 1) % VIEW_MODES.length]! }));
      } else if (id === "view-swap") {
        setSwapped((sw) => !sw);
      } else if (id === "delete") {
        deleteSelection();
      } else {
        runMenuActionRef.current(id); // copy/paste/align/flip/order/... — the shared dispatcher
      }
    };

    const onKey = (e: KeyboardEvent): void => {
      const tgt = e.target;
      if (
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLSelectElement ||
        tgt instanceof HTMLTextAreaElement ||
        (tgt instanceof HTMLElement && tgt.isContentEditable)
      )
        return;
      // Ctrl/Cmd+Shift+Z = redo (Photoshop-style), a fixed alias alongside the rebindable Ctrl+Y.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        workspaceRef.current?.active?.store.redo();
        return;
      }
      // Space is the hold-to-pan modifier (CanvasView tracks its own keydown/keyup); swallow it here so
      // it never scrolls the page or triggers a focused button.
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
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
      // Backspace stays a fixed alias for the delete command (its own chord is rebindable)
      if (e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
        return;
      }
      // rebindable editor-scope commands
      for (const b of bindingsRef.current) {
        if (matchEvent(b.chord, e)) {
          e.preventDefault();
          runEditorCommand(b.id);
          return;
        }
      }
      const id = store.state.selectedId;
      if (e.key.startsWith("Arrow") && id && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const node = findNode(store.state.doc.layers, id);
        const object = node && isObject(node) ? node : null;
        const verts = selVertsRef.current;
        if (object?.bezier && verts.length > 0) {
          // nudge selected path anchors (handles are offsets and follow) — through applyBezierEdit
          // so rings/polygon objects rebake their controlPoints (else the field lags the gizmo)
          store.update(
            (d) =>
              updateObject(d, id, (s) =>
                applyBezierEdit(
                  s,
                  s.bezier!.map((a, i) => (verts.includes(i) ? { ...a, p: v2(a.p.x + dx, a.p.y + dy) } : a)),
                ),
              ),
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
          // updateNode, not updateObject: the selected node may be a GROUP (updateObject only
          // patches objects, so a group nudge silently no-oped)
          store.update(
            (d) => ({
              ...d,
              layers: updateNode(d.layers, id, (n) => ({
                ...n,
                transform: { ...n.transform, pos: n.transform.pos.withX(n.transform.pos.x + dx).withY(n.transform.pos.y + dy) },
              })),
            }),
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

/** Build the parsed editor-binding list from effective (id, chord-string) pairs. */
export function parseEditorBindings(pairs: Array<[string, string]>): EditorBinding[] {
  return pairs.map(([id, keys]) => ({ id, chord: parseChord(keys) }));
}
