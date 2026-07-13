import { useEffect, useState } from "react";
import { matchEvent, parseChord } from "@carapace/shell";
import { Vector2 } from "@aphralatrax/primitives";
import type { DocumentStore } from "../document/store";
import type { LambertDoc } from "../document/schema";
import { nodeFrames, updateNode } from "../document/layerOps";
import { affineApply } from "../field/affine";
import { BezierAnchor, bakeMaskLoop, resolveHandlesClosed } from "../field/bezier";
import { dragHandle, insertOnClosed, isCornerAnchor as isCorner, movePoint, toggleMode } from "../field/bezierEdit";
import { setMaskSpace } from "../field/maskOps";
import type { Mask } from "../field/types";
import { v2 } from "../field/vec";
import { ContextMenu, MenuEntry } from "./kit";
import { editSnap } from "./snapPoint";
import { grabGroup, ROTATE_SNAP, toggleIndex } from "./picking";
import { canvasToScreen, Viewport } from "./viewport";
import { eventToCanvas } from "./canvasCoords";
import { HANDLE_DRAG_PX, usePointerDrag } from "./usePointerDrag";
import { AnchorHandles, GizmoHalo } from "./gizmoChrome";

/** One in-flight mask-anchor drag. `sel`/`startPos` let a multi-anchor selection — or a whole-mask
 *  body drag (every anchor selected) — translate by one shared snapped delta; tangent drags use `i`. */
interface MaskDragState {
  mi: number;
  kind: "point" | "in" | "out";
  i: number;
  moved: boolean;
  sel: number[];
  startCursor: Vector2;
  startPos: Map<number, Vector2>;
  collapseOnUp: boolean;
}

/**
 * On-canvas editor for a node's trim masks (an object OR a group). Renders each mask's outline + Bézier
 * anchors/tangents and lets you drag/insert/delete/retype them; commits through `updateNode` so it is
 * node-agnostic. Follow masks live in the node's LOCAL frame (mapped through its full world affine, so
 * nesting is correct); pinned masks live in world space. Self-contained: owns its own selection, drag,
 * and context-menu state, and renders its own overlay svg + menus.
 */
export function MaskGizmo(props: {
  nodeId: string;
  masks: Mask[];
  doc: LambertDoc;
  viewport: Viewport;
  snap: boolean;
  store: DocumentStore;
  /** Inspector "select this mask": seq bumps per click so re-selecting the same mask re-applies. */
  focus: { maskId: string; seq: number } | null;
  /** The effective (rebindable) delete chord — this gizmo owns it while a mask anchor is selected. */
  deleteKeys: string | null;
}): React.JSX.Element {
  const { nodeId, masks, doc, viewport, snap, store, focus, deleteKeys } = props;
  const [maskSel, setMaskSel] = useState<{ mi: number; anchors: number[] } | null>(null);
  // apply an inspector mask-selection: pick the mask and select ALL its anchors
  useEffect(() => {
    if (!focus) return;
    const mi = masks.findIndex((m) => m.id === focus.maskId);
    if (mi >= 0) setMaskSel({ mi, anchors: masks[mi]!.anchors.map((_, ai) => ai) });
    // masks identity churns every doc edit; only a CLICK (seq bump) should re-apply
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq]);
  // a point drag carries the selection it moves + each member's start position (mask-space) so the
  // whole set translates by one shared, snapped delta; tangent drags only use `i`.
  const maskDrag = usePointerDrag<MaskDragState>();
  const [maskMenu, setMaskMenu] = useState<{ x: number; y: number; mi: number; i: number } | null>(null);
  const [maskLineMenu, setMaskLineMenu] = useState<{ x: number; y: number; mi: number; pt: Vector2 } | null>(null);

  const { worldAffine, invWorld } = nodeFrames(doc.layers, nodeId);
  const w2l = (p: Vector2): Vector2 => affineApply(invWorld, p);
  const snapPt = editSnap(doc.canvas, snap, viewport.zoom);
  const eventCanvasPoint = (e: React.MouseEvent): Vector2 => eventToCanvas(e, viewport);

  // replace this node's masks (any node), optionally coalescing a drag into one undo step
  const commitMasks = (next: Mask[], coalesce?: string): void => {
    store.update((d) => ({ ...d, layers: updateNode(d.layers, nodeId, (n) => ({ ...n, masks: next })) }), coalesce ? { coalesce } : {});
  };
  const setAnchors = (mi: number, anchors: BezierAnchor[], coalesce: string): void =>
    commitMasks(masks.map((m, idx) => (idx === mi ? { ...m, anchors } : m)), coalesce);

  // While a mask anchor is selected, this gizmo owns Delete: remove the selected anchor(s) (never
  // below the 3-anchor floor) in the CAPTURE phase, before App's window keydown — which would
  // otherwise delete the whole object. And a left-click that reaches window (i.e. NOT on an anchor —
  // anchor pointerdowns stop propagation) clears the anchor selection: "click elsewhere deselects the
  // vertex, not the object" (the object stays selected; ESC, handled by App, deselects the object).
  useEffect(() => {
    if (!maskSel) return;
    const onKey = (e: KeyboardEvent): void => {
      // the rebindable delete chord (single-step; effective binding from App) + the fixed Backspace alias
      const chord = deleteKeys ? parseChord(deleteKeys) : null;
      if (!(chord && matchEvent(chord, e)) && e.key !== "Backspace") return;
      const m = masks[maskSel.mi];
      if (m && m.anchors.length - maskSel.anchors.length >= 3) {
        const drop = new Set(maskSel.anchors);
        setAnchors(maskSel.mi, m.anchors.filter((_, idx) => !drop.has(idx)), `maskdel:${nodeId}`);
        store.endGesture();
        setMaskSel(null);
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onDown = (e: PointerEvent): void => {
      if (e.button === 0) setMaskSel(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [maskSel, masks, nodeId, deleteKeys]);

  // flip a mask's follow flag, converting its anchors through the node's WORLD frame so it doesn't jump
  const toggleFollow = (m: Mask): Mask => setMaskSpace(m, !m.follow, worldAffine, invWorld);

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <GizmoHalo id="maskgizmo-halo" />
        </defs>
        <g filter="url(#maskgizmo-halo)">
          {masks.map((m, mi) => {
            const stroke = m.mode === "cut" ? "var(--color-cut)" : "var(--color-accent)";
            // follow masks store anchors in the node's LOCAL space; pinned masks in WORLD space
            const toScreen = (p: Vector2): Vector2 =>
              m.follow ? canvasToScreen(viewport, affineApply(worldAffine, p)) : canvasToScreen(viewport, p);
            const toSpace = (e: React.MouseEvent): Vector2 => (m.follow ? w2l(eventCanvasPoint(e)) : eventCanvasPoint(e));
            const loop = bakeMaskLoop(m.anchors).map((p) => toScreen(p));
            const ring = loop.map((s) => `${s.x},${s.y}`).join(" ");
            const resolved = resolveHandlesClosed(m.anchors);
            // shared by the anchor handles AND the whole-mask body drag: a "point" drag snaps the primary
            // (grabbed) anchor then translates the whole selected set by that delta; a tangent drag edits
            // one handle. Extracted so the body drag can reuse the exact same translate + undo grouping.
            const sharedMove = (e: React.PointerEvent, dg: MaskDragState): void => {
              if (dg.mi !== mi) return;
              dg.moved = true;
              if (dg.kind === "point") {
                const primStart = dg.startPos.get(dg.i)!;
                const primStartCanvas = m.follow ? affineApply(worldAffine, primStart) : primStart;
                const cur = eventCanvasPoint(e);
                const rawCanvas = v2(primStartCanvas.x + (cur.x - dg.startCursor.x), primStartCanvas.y + (cur.y - dg.startCursor.y));
                const primNew = m.follow ? w2l(snapPt(rawCanvas)) : snapPt(rawCanvas);
                if (dg.sel.length <= 1) {
                  setAnchors(mi, movePoint(m.anchors, dg.i, primNew, e.altKey), `mask:${nodeId}:${mi}`);
                  return;
                }
                const dx = primNew.x - primStart.x;
                const dy = primNew.y - primStart.y;
                const next = m.anchors.map((a, idx) => {
                  const s = dg.startPos.get(idx);
                  return s ? { ...a, p: v2(s.x + dx, s.y + dy) } : a;
                });
                setAnchors(mi, next, `mask:${nodeId}:${mi}`);
                return;
              }
              // bake the dragged anchor's resolved tangents first so an independent drag keeps the
              // other tangent at its auto value (smooth anchors store zero, which would otherwise vanish)
              const rc = resolveHandlesClosed(m.anchors)[dg.i]!;
              const based = m.anchors.map((a, idx) => (idx === dg.i ? { ...a, hIn: rc.hIn, hOut: rc.hOut, mode: "manual" as const } : a));
              const sym = m.anchors[dg.i]!.sym !== false;
              setAnchors(mi, dragHandle(based, dg.i, dg.kind, toSpace(e), sym !== e.altKey, e.shiftKey ? ROTATE_SNAP : undefined), `mask:${nodeId}:${mi}`);
            };
            const sharedEnd = (_e: React.PointerEvent, dg: MaskDragState): void => {
              if (dg.collapseOnUp && !dg.moved) setMaskSel({ mi: dg.mi, anchors: [dg.i] });
              store.endGesture();
            };
            const handle = (kind: "point" | "in" | "out", i: number) =>
              maskDrag({
                onStart: (e) => {
                  if (e.button !== 0) return null;
                  if (kind !== "point") {
                    // tangents are per-anchor: never group, never change the point selection
                    return { mi, kind, i, moved: false, sel: [i], startCursor: v2(0, 0), startPos: new Map(), collapseOnUp: false };
                  }
                  const cur = maskSel?.mi === mi ? maskSel.anchors : [];
                  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                  if (additive) {
                    // toggle this anchor in/out of the selection; no drag (stop here so the canvas doesn't act)
                    e.stopPropagation();
                    setMaskSel({ mi, anchors: toggleIndex(cur, i) });
                    return null;
                  }
                  // plain click: keep a multi-selection you grabbed inside (so the drag moves all), else pick this one
                  const sel = grabGroup(cur, i);
                  setMaskSel({ mi, anchors: sel });
                  return {
                    mi,
                    kind,
                    i,
                    moved: false,
                    sel,
                    startCursor: eventCanvasPoint(e),
                    startPos: new Map(sel.map((idx) => [idx, m.anchors[idx]!.p])),
                    collapseOnUp: sel.length > 1, // a click-without-drag inside a multi-sel narrows to this anchor
                  };
                },
                onMove: sharedMove,
                onEnd: sharedEnd,
                threshold: HANDLE_DRAG_PX,
              });
            // whole-mask body drag: press INSIDE the loop -> translate every anchor by one shared, snapped
            // delta. Reuses the multi-anchor group-translate with the ENTIRE ring selected, so it commits
            // as one undo step — no more selecting every anchor first just to move a mask as a unit.
            const bodyDrag = maskDrag({
              onStart: (e) => {
                if (e.button !== 0) return null;
                const sel = m.anchors.map((_, idx) => idx);
                setMaskSel({ mi, anchors: sel });
                return {
                  mi,
                  kind: "point" as const,
                  i: 0,
                  moved: false,
                  sel,
                  startCursor: eventCanvasPoint(e),
                  startPos: new Map(sel.map((idx) => [idx, m.anchors[idx]!.p])),
                  collapseOnUp: false,
                };
              },
              onMove: sharedMove,
              onEnd: sharedEnd,
              threshold: HANDLE_DRAG_PX,
            });
            const active = maskSel?.mi === mi; // this mask is the one being edited (an anchor was picked)
            return (
              <g key={`mask-${m.id}`} opacity={m.visible === false ? 0.4 : 1}>
                {/* interior fill = grab to move the whole mask as a unit, but ONLY once this mask is active
                    (you've clicked one of its anchors). Otherwise it's pointer-transparent so a press inside
                    falls through to the object gizmo underneath — i.e. dragging the SHAPE stays the default.
                    First child (lowest z) so the outline hit-strip and anchor handles below still win. */}
                <polygon
                  points={ring}
                  fill="transparent"
                  style={{ pointerEvents: active ? "fill" : "none", cursor: "move" }}
                  {...bodyDrag}
                />
                <polygon
                  points={ring}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1.5}
                  strokeOpacity={0.85}
                  strokeDasharray={m.visible === false ? "2 4" : m.mode === "cut" ? "5 3" : undefined}
                />
                {/* fat invisible hit strip: click the loop to insert an anchor */}
                <polygon
                  points={ring}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ pointerEvents: "stroke", cursor: "copy" }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const r = insertOnClosed(m.anchors, toSpace(e));
                    if (!r) return;
                    setAnchors(mi, r.anchors, `maskins:${nodeId}:${mi}`);
                    store.endGesture();
                    setMaskSel({ mi, anchors: [r.index] });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMaskLineMenu({ x: e.clientX, y: e.clientY, mi, pt: toSpace(e) });
                  }}
                />
                <AnchorHandles
                  resolved={resolved}
                  toScreen={toScreen}
                  color={stroke}
                  tangentProps={handle}
                  isCorner={(i) => isCorner(m.anchors[i]!)}
                  isSelected={(i) => maskSel?.mi === mi && maskSel.anchors.includes(i)}
                  anchorProps={(i) => ({
                    ...handle("point", i),
                    onContextMenu: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMaskMenu({ x: e.clientX, y: e.clientY, mi, i });
                    },
                  })}
                />
              </g>
            );
          })}
        </g>
      </svg>
      {maskMenu
        ? (() => {
            const m = masks[maskMenu.mi];
            if (!m) return null;
            const items: MenuEntry[] = [
              {
                label: isCorner(m.anchors[maskMenu.i]!) ? "Make Smooth" : "Make Corner",
                onClick: () => {
                  setAnchors(maskMenu.mi, toggleMode(m.anchors, maskMenu.i), `maskmode:${nodeId}`);
                  store.endGesture();
                },
              },
            ];
            if (!isCorner(m.anchors[maskMenu.i]!)) {
              items.push({
                label: m.anchors[maskMenu.i]!.sym === false ? "Make Tangents Symmetric" : "Make Tangents Independent",
                onClick: () => {
                  setAnchors(
                    maskMenu.mi,
                    m.anchors.map((a, idx) => (idx === maskMenu.i ? { ...a, sym: a.sym === false } : a)),
                    `masksym:${nodeId}`,
                  );
                  store.endGesture();
                },
              });
            }
            // delete the whole selection when right-clicking one of its members, else just this anchor
            const delTargets =
              maskSel?.mi === maskMenu.mi && maskSel.anchors.includes(maskMenu.i) && maskSel.anchors.length > 1
                ? maskSel.anchors
                : [maskMenu.i];
            if (m.anchors.length - delTargets.length >= 3) {
              const drop = new Set(delTargets);
              items.push("separator", {
                label: delTargets.length > 1 ? `Delete ${delTargets.length} Vertices` : "Delete Vertex",
                danger: true,
                onClick: () => {
                  setAnchors(maskMenu.mi, m.anchors.filter((_, idx) => !drop.has(idx)), `maskdel:${nodeId}`);
                  store.endGesture();
                  setMaskSel(null);
                },
              });
            }
            return <ContextMenu x={maskMenu.x} y={maskMenu.y} items={items} onClose={() => setMaskMenu(null)} />;
          })()
        : null}
      {maskLineMenu
        ? (() => {
            const m = masks[maskLineMenu.mi];
            if (!m) return null;
            const commit1 = (next: Mask): void => {
              commitMasks(masks.map((mm) => (mm.id === m.id ? next : mm)));
              store.endGesture();
            };
            const items: MenuEntry[] = [
              {
                label: "Add Anchor",
                onClick: () => {
                  const r = insertOnClosed(m.anchors, maskLineMenu.pt);
                  if (!r) return;
                  setAnchors(maskLineMenu.mi, r.anchors, `maskins:${nodeId}:${maskLineMenu.mi}`);
                  store.endGesture();
                  setMaskSel({ mi: maskLineMenu.mi, anchors: [r.index] });
                },
              },
              "separator",
              {
                label: m.mode === "cut" ? "Make Keep Mask" : "Make Cut Mask",
                onClick: () => commit1({ ...m, mode: m.mode === "cut" ? "keep" : "cut" }),
              },
              {
                label: m.follow ? "Pin to Canvas" : "Attach to Layer",
                onClick: () => commit1(toggleFollow(m)),
              },
              "separator",
              {
                label: "Delete Mask",
                danger: true,
                onClick: () => {
                  commitMasks(masks.filter((mm) => mm.id !== m.id));
                  store.endGesture();
                },
              },
            ];
            return <ContextMenu x={maskLineMenu.x} y={maskLineMenu.y} items={items} onClose={() => setMaskLineMenu(null)} />;
          })()
        : null}
    </>
  );
}
