import { useEffect } from "react";
import { createChordMatcher, parseChord } from "@carapace/shell";
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
 * delete, rename, and anything the user binds) match through the REBINDABLE chord list
 * (bindingsRef, derived from the command model + user overrides), including two-step chords via
 * the carapace chord matcher.
 *
 * DOCUMENTED CARVE-OUTS — the keys that deliberately stay hardcoded, because they're modal,
 * gestural, or focus-scoped rather than commands:
 *  - Esc: drag-cancel / deselect (and chord-prefix cancel, via the matcher);
 *  - Space: hold-to-pan modifier (swallowed here, tracked by CanvasView);
 *  - arrow keys: nudge (coalesced per burst) — widget navigation elsewhere;
 *  - Ctrl+Y: fixed legacy redo alias alongside the rebindable Ctrl+Shift+Z;
 *  - Backspace: fixed delete alias alongside the rebindable Delete;
 *  - dialog/input-local keys (dialog Enter, rename inputs, LightPad arrows, pen-draft Esc/Enter)
 *    and carapace widget navigation (arrows/Home/End/Enter/Ctrl+A) — those handlers preventDefault
 *    and this keymap yields to defaultPrevented.
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
  /** A two-step chord prefix is pending (string) or resolved (null) — drives the status hint. */
  onChordPending?: (prefix: string | null) => void;
}): void {
  const { workspaceRef, runMenuActionRef, bindingsRef, selVertsRef, nudgeEndTimer, setSwapped, setSelVerts, setTool, setActiveView, onChordPending } = opts;
  useEffect(() => {
    // the modal Delete: selected anchors -> selected vertices -> selected layers
    const deleteSelection = (): void => {
      const t = workspaceRef.current?.active;
      if (!t || t.kind !== "doc") return; // image tabs have no editable selection
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
        setActiveView((s) => ({ ...s, mode: VIEW_MODES[(VIEW_MODES.indexOf(s.mode) + 1) % VIEW_MODES.length]!, prevMode: s.mode }));
      } else if (id === "view-swap") {
        setSwapped((sw) => !sw);
      } else if (id === "delete") {
        deleteSelection();
      } else {
        runMenuActionRef.current(id); // copy/paste/align/flip/order/... — the shared dispatcher
      }
    };

    // two-step chord state (Ctrl+K U style): while a prefix is pending, the NEXT keystroke belongs
    // to the matcher — before any fixed handling (Esc must cancel the chord, not deselect).
    const matcher = createChordMatcher();
    let chordPending = false;
    const resolvePending = (): void => {
      chordPending = false;
      onChordPending?.(null);
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
      // a focused widget (carapace tree, mask gizmo) that consumed the key wins — never double-fire
      if (e.defaultPrevented) return;
      if (chordPending) {
        const m = matcher.feed(bindingsRef.current, e);
        if (m.type === "none") return; // bare modifier — the prefix stays pending
        resolvePending();
        e.preventDefault();
        if (m.type === "run") runEditorCommand(m.id);
        return; // cancel: swallowed, nothing dispatched
      }
      // Ctrl/Cmd+Y = redo, a fixed legacy alias alongside the rebindable Ctrl+Shift+Z (Photoshop).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        const a = workspaceRef.current?.active;
        if (a?.kind === "doc") a.store.redo();
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
      if (t.kind !== "doc") {
        // image tab: no document editing, but rebindable commands (close-tab, tab-next, …)
        // still dispatch — doc-only ids no-op in the shared dispatcher.
        const m = matcher.feed(bindingsRef.current, e);
        if (m.type === "run") {
          e.preventDefault();
          runEditorCommand(m.id);
        } else if (m.type === "pending") {
          e.preventDefault();
          chordPending = true;
          onChordPending?.(m.prefix);
        }
        return;
      }
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
      // rebindable editor-scope commands (single-step runs; a chord prefix goes pending)
      const m = matcher.feed(bindingsRef.current, e);
      if (m.type === "run") {
        e.preventDefault();
        runEditorCommand(m.id);
        return;
      }
      if (m.type === "pending") {
        e.preventDefault();
        chordPending = true;
        onChordPending?.(m.prefix);
        return;
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
          // updateNode, not updateObject: a selected node may be a GROUP (updateObject only
          // patches objects, so a group nudge silently no-oped). Nudge the WHOLE multi-selection
          // in unison — canvas drag moves every member, arrows match.
          const ids = store.state.selectedIds;
          store.update(
            (d) => ({
              ...d,
              layers: ids.reduce(
                (ls, oid) =>
                  updateNode(ls, oid, (n) => ({
                    ...n,
                    transform: { ...n.transform, pos: n.transform.pos.withX(n.transform.pos.x + dx).withY(n.transform.pos.y + dy) },
                  })),
                d.layers,
              ),
            }),
            { coalesce: `nudge:${ids.join("+")}` },
          );
        }
        // a burst of nudges collapses to one undo entry; commit it after a short pause so the next
        // edit (or a later nudge after thinking) is its own undo step.
        if (nudgeEndTimer.current) clearTimeout(nudgeEndTimer.current);
        nudgeEndTimer.current = setTimeout(() => store.endGesture(), 500);
      }
    };
    const onBlur = (): void => {
      matcher.reset();
      resolvePending();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Build the parsed editor-binding list from effective (id, chord-string) pairs. */
export function parseEditorBindings(pairs: Array<[string, string]>): EditorBinding[] {
  return pairs.map(([id, keys]) => ({ id, chord: parseChord(keys) }));
}
