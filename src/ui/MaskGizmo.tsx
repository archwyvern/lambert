import { useRef, useState } from "react";
import { Vector2 } from "@carapace/primitives";
import type { DocumentStore } from "../document/store";
import type { LambertDoc } from "../document/schema";
import { nodeWorldAffine, updateNode } from "../document/layerOps";
import { affineApply, affineIdentity, affineInvert } from "../field/affine";
import { BezierAnchor, bakeMaskLoop, resolveHandlesClosed } from "../field/bezier";
import { dragHandle, insertOnClosed, movePoint, toggleMode } from "../field/bezierEdit";
import type { Mask } from "../field/types";
import { v2 } from "../field/vec";
import { ContextMenu, MenuEntry } from "./kit";
import { snapCanvasPoint } from "./snapPoint";
import { canvasToScreen, screenToCanvas, Viewport } from "./viewport";

const ROTATE_SNAP = Math.PI / 12; // 15deg; Shift snaps a tangent's direction

/** A corner = a manual anchor with zero-length handles (no tangents). */
const isCorner = (a: BezierAnchor): boolean =>
  a.mode === "manual" && a.hIn.x === 0 && a.hIn.y === 0 && a.hOut.x === 0 && a.hOut.y === 0;

/**
 * On-canvas editor for a node's trim masks (a shape OR a group). Renders each mask's outline + Bézier
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
}): React.JSX.Element {
  const { nodeId, masks, doc, viewport, snap, store } = props;
  const [maskSel, setMaskSel] = useState<{ mi: number; anchors: number[] } | null>(null);
  // a point drag carries the selection it moves + each member's start position (mask-space) so the
  // whole set translates by one shared, snapped delta; tangent drags only use `i`.
  const maskDrag = useRef<{
    mi: number;
    kind: "point" | "in" | "out";
    i: number;
    moved: boolean;
    sel: number[];
    startCursor: Vector2;
    startPos: Map<number, Vector2>;
    collapseOnUp: boolean;
  } | null>(null);
  const [maskMenu, setMaskMenu] = useState<{ x: number; y: number; mi: number; i: number } | null>(null);
  const [maskLineMenu, setMaskLineMenu] = useState<{ x: number; y: number; mi: number; pt: Vector2 } | null>(null);

  const worldAffine = nodeWorldAffine(doc.layers, nodeId) ?? affineIdentity();
  const invWorld = affineInvert(worldAffine);
  const w2l = (p: Vector2): Vector2 => affineApply(invWorld, p);
  const snapPt = (p: Vector2): Vector2 =>
    snapCanvasPoint(p, { grid: snap, guides: doc.canvas.snapToGuides, guideLines: doc.canvas.guides, zoom: viewport.zoom });
  const eventCanvasPoint = (e: React.MouseEvent): Vector2 => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - r.left, e.clientY - r.top));
  };

  // replace this node's masks (any node), optionally coalescing a drag into one undo step
  const commitMasks = (next: Mask[], coalesce?: string): void => {
    store.update((d) => ({ ...d, layers: updateNode(d.layers, nodeId, (n) => ({ ...n, masks: next })) }), coalesce ? { coalesce } : {});
  };
  const setAnchors = (mi: number, anchors: BezierAnchor[], coalesce: string): void =>
    commitMasks(masks.map((m, idx) => (idx === mi ? { ...m, anchors } : m)), coalesce);

  // flip a mask's follow flag, converting its anchors through the node's WORLD frame so it doesn't jump
  const toggleFollow = (m: Mask): Mask => {
    const follow = !m.follow;
    const conv = follow ? (p: Vector2): Vector2 => w2l(p) : (p: Vector2): Vector2 => affineApply(worldAffine, p);
    const anchors = m.anchors.map((a) => {
      const p = conv(a.p);
      const out = conv(v2(a.p.x + a.hOut.x, a.p.y + a.hOut.y));
      const inn = conv(v2(a.p.x + a.hIn.x, a.p.y + a.hIn.y));
      return { ...a, p, hOut: v2(out.x - p.x, out.y - p.y), hIn: v2(inn.x - p.x, inn.y - p.y) };
    });
    return { ...m, follow, anchors };
  };

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <filter id="maskgizmo-halo" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#000000" floodOpacity="0.9" />
          </filter>
        </defs>
        <g filter="url(#maskgizmo-halo)">
          {masks.map((m, mi) => {
            const stroke = m.mode === "cut" ? "#e06c6c" : "var(--color-accent)";
            // follow masks store anchors in the node's LOCAL space; pinned masks in WORLD space
            const toScreen = (p: Vector2): Vector2 =>
              m.follow ? canvasToScreen(viewport, affineApply(worldAffine, p)) : canvasToScreen(viewport, p);
            const toSpace = (e: React.MouseEvent): Vector2 => (m.follow ? w2l(eventCanvasPoint(e)) : eventCanvasPoint(e));
            const loop = bakeMaskLoop(m.anchors).map((p) => toScreen(p));
            const ring = loop.map((s) => `${s.x},${s.y}`).join(" ");
            const resolved = resolveHandlesClosed(m.anchors);
            const handle = (kind: "point" | "in" | "out", i: number) => ({
              onPointerDown: (e: React.PointerEvent) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                if (kind !== "point") {
                  // tangents are per-anchor: never group, never change the point selection
                  maskDrag.current = { mi, kind, i, moved: false, sel: [i], startCursor: v2(0, 0), startPos: new Map(), collapseOnUp: false };
                  return;
                }
                const cur = maskSel?.mi === mi ? maskSel.anchors : [];
                const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                if (additive) {
                  // toggle this anchor in/out of the selection; no drag
                  setMaskSel({ mi, anchors: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] });
                  maskDrag.current = null;
                  return;
                }
                // plain click: keep a multi-selection you grabbed inside (so the drag moves all), else pick this one
                const sel = cur.includes(i) ? cur : [i];
                setMaskSel({ mi, anchors: sel });
                maskDrag.current = {
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
              onPointerMove: (e: React.PointerEvent) => {
                const dg = maskDrag.current;
                if (!dg || dg.mi !== mi) return;
                dg.moved = true;
                if (dg.kind === "point") {
                  // snap the PRIMARY (grabbed) anchor, then translate every selected anchor by that delta
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
              },
              onPointerUp: (e: React.PointerEvent) => {
                e.stopPropagation();
                const dg = maskDrag.current;
                if (dg && dg.collapseOnUp && !dg.moved) setMaskSel({ mi: dg.mi, anchors: [dg.i] });
                maskDrag.current = null;
                store.endGesture();
              },
            });
            return (
              <g key={`mask-${m.id}`} opacity={m.visible === false ? 0.4 : 1}>
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
                {resolved.map((a, i) => {
                  const pS = toScreen(a.p);
                  const outS = toScreen(v2(a.p.x + a.hOut.x, a.p.y + a.hOut.y));
                  const inS = toScreen(v2(a.p.x + a.hIn.x, a.p.y + a.hIn.y));
                  const hasOut = a.hOut.x !== 0 || a.hOut.y !== 0;
                  const hasIn = a.hIn.x !== 0 || a.hIn.y !== 0;
                  const corner = isCorner(m.anchors[i]!);
                  const sel = maskSel?.mi === mi && maskSel.anchors.includes(i);
                  return (
                    <g key={`ma-${i}`}>
                      {hasOut ? <line x1={pS.x} y1={pS.y} x2={outS.x} y2={outS.y} stroke={stroke} strokeWidth={1} strokeOpacity={0.6} /> : null}
                      {hasIn ? <line x1={pS.x} y1={pS.y} x2={inS.x} y2={inS.y} stroke={stroke} strokeWidth={1} strokeOpacity={0.6} /> : null}
                      {hasOut ? (
                        <g {...handle("out", i)} style={{ cursor: "move" }}>
                          <circle cx={outS.x} cy={outS.y} r={11} fill="transparent" style={{ pointerEvents: "auto" }} />
                          <circle cx={outS.x} cy={outS.y} r={4} fill="#191a1b" stroke={stroke} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                        </g>
                      ) : null}
                      {hasIn ? (
                        <g {...handle("in", i)} style={{ cursor: "move" }}>
                          <circle cx={inS.x} cy={inS.y} r={11} fill="transparent" style={{ pointerEvents: "auto" }} />
                          <circle cx={inS.x} cy={inS.y} r={4} fill="#191a1b" stroke={stroke} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                        </g>
                      ) : null}
                      <g
                        {...handle("point", i)}
                        style={{ cursor: "move" }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMaskMenu({ x: e.clientX, y: e.clientY, mi, i });
                        }}
                      >
                        <circle cx={pS.x} cy={pS.y} r={12} fill="transparent" style={{ pointerEvents: "auto" }} />
                        {corner ? (
                          <rect
                            x={pS.x - 5}
                            y={pS.y - 5}
                            width={10}
                            height={10}
                            transform={`rotate(45 ${pS.x} ${pS.y})`}
                            fill={stroke}
                            stroke={sel ? "#ffffff" : "#191a1b"}
                            strokeWidth={1.5}
                            style={{ pointerEvents: "none" }}
                          />
                        ) : (
                          <circle cx={pS.x} cy={pS.y} r={5} fill={stroke} stroke={sel ? "#ffffff" : "#191a1b"} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                        )}
                      </g>
                    </g>
                  );
                })}
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
