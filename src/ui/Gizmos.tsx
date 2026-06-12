import { useRef, useState } from "react";
import type { DocumentStore } from "../document/store";
import { updateShape } from "../document/docOps";
import type { LambertDoc } from "../document/schema";

import { frustumStrip } from "../field/controlPoints";
import {
  alignVertToPlane,
  connectVerts,
  deleteEdge,
  deleteVerts,
  mergeVerts,
  meshEdges,
  neighborsOf,
  splitEdge,
} from "../field/meshOps";
import { getShapeType } from "../field/registry";
import { alignedToAxis, snapVec } from "../field/snap";
import { fromLocal, toLocal } from "../field/transform";
import type { ShapeInstance } from "../field/types";
import { v2, Vec2 } from "../field/vec";
import { ContextMenu, MenuEntry } from "./kit";
import { axisScaleFromDrag, groupScaleFactor, pointsBounds, scalePointsAbout } from "./picking";
import type { ToolMode } from "./tools";
import { canvasToScreen, screenToCanvas, Viewport } from "./viewport";

/** Shape-local footprint bounds (control-point extents; dome from its radii). */
function localBounds(s: ShapeInstance): { min: Vec2; max: Vec2 } {
  if (s.controlPoints.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of s.controlPoints) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { min: v2(minX, minY), max: v2(maxX, maxY) };
  }
  return { min: v2(-48, -48), max: v2(48, 48) }; // dome: nominal radius, ellipse via scale
}

/** Forward of toLocal: scale THEN rotate, then translate (pinned by picking.test.ts). */
const localToCanvas = (s: ShapeInstance, cp: Vec2): Vec2 => fromLocal(s.transform, cp);

const PAD = 6; // local-px breathing room around the footprint

export function Gizmos(props: {
  doc: LambertDoc;
  selectedId: string | null;
  viewport: Viewport;
  store: DocumentStore;
  /** Full handle set only in select mode; explicit godot tools show the frame alone. */
  tool: ToolMode;
  /** Selected control-point indices (lifted to CanvasView so the marquee can drive them). */
  selVerts: number[];
  setSelVerts: (v: number[] | ((p: number[]) => number[])) => void;
}): React.JSX.Element | null {
  const { doc, selectedId, viewport, store, tool, selVerts, setSelVerts } = props;
  const unlocked = !doc.shapes.find((s) => s.id === selectedId)?.locked;
  const handles = tool === "select" && unlocked; // shape transform handles (corners/edges)
  const vertHandles = (tool === "select" || tool === "vertex") && unlocked; // vertex dots + group
  const dragState = useRef<{
    start: Vec2;
    rotation: number;
    scale: { x: number; y: number; z: number };
    pos: { x: number; y: number; z: number };
    /** Fixed point the scale pivots about (the opposite corner/edge), local + canvas. */
    anchorLocal: Vec2;
    anchorCanvas: Vec2;
  } | null>(null);
  // multi-vertex selection lives in CanvasView; this is the move/scale drag state
  const vertDrag = useRef<{ startCanvas: Vec2; starts: { i: number; p: Vec2 }[]; pivot: Vec2 } | null>(null);
  // true while a vertex is held/dragged — gates the octant alignment guide on the edge lines
  const [draggingVert, setDraggingVert] = useState(false);
  // right-click context menu: `verts` = the set Connect/Merge/Delete act on; `zalign` = align a 4th
  // vertex onto the plane of 3 selected; `edge` = add a vertex on that edge
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    verts: number[];
    target: number | null; // the right-clicked vertex (merge welds onto this one)
    zalign: { target: number; plane: number[] } | null;
    edge: { ia: number; ib: number; t: number } | null;
  } | null>(null);
  const shape = doc.shapes.find((s) => s.id === selectedId);
  if (!shape) return null;

  const bounds = localBounds(shape);
  const pad = PAD / Math.max(0.0001, (Math.abs(shape.transform.scale.x) + Math.abs(shape.transform.scale.y)) / 2);
  const cornersLocal = [
    v2(bounds.min.x - pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.max.y + pad),
    v2(bounds.min.x - pad, bounds.max.y + pad),
  ];
  const corners = cornersLocal.map((c) => canvasToScreen(viewport, localToCanvas(shape, c)));
  // footprint corners (no pad): stable during a scale drag, used as scale anchors
  const boundsCorners = [
    v2(bounds.min.x, bounds.min.y),
    v2(bounds.max.x, bounds.min.y),
    v2(bounds.max.x, bounds.max.y),
    v2(bounds.min.x, bounds.max.y),
  ];

  const eventCanvasPoint = (e: React.MouseEvent): Vec2 => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };

  const begin = (anchorLocal: Vec2) => (e: React.PointerEvent): void => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = {
      start: eventCanvasPoint(e),
      rotation: shape.transform.rotation,
      scale: { ...shape.transform.scale },
      pos: { ...shape.transform.pos },
      anchorLocal,
      anchorCanvas: localToCanvas(shape, anchorLocal),
    };
  };

  const handleProps = (anchorLocal: Vec2, apply: (p: Vec2, e: React.PointerEvent) => void) => ({
    onPointerDown: begin(anchorLocal),
    onPointerMove: (e: React.PointerEvent) => {
      if (!dragState.current) return;
      apply(eventCanvasPoint(e), e);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      dragState.current = null;
      store.endGesture();
    },
  });

  /** Apply a new scale while pinning the drag anchor (opposite corner/edge) in place. */
  const scaleAround = (sc: { x: number; y: number; z: number }): void => {
    const ds = dragState.current!;
    const c = Math.cos(ds.rotation);
    const s = Math.sin(ds.rotation);
    const rx = ds.anchorLocal.x * sc.x;
    const ry = ds.anchorLocal.y * sc.y;
    // pos shifts so anchorLocal still lands on anchorCanvas under the new scale
    const pos = { x: ds.anchorCanvas.x - (rx * c - ry * s), y: ds.anchorCanvas.y - (rx * s + ry * c), z: ds.pos.z };
    store.update(
      (d) => updateShape(d, shape.id, (sh) => ({ ...sh, transform: { ...sh.transform, scale: sc, pos } })),
      { coalesce: `scale:${shape.id}` },
    );
  };

  /** Corner drag: scales both footprint axes from the opposite corner (shift = uniform). */
  const cornerScale = (i: number) =>
    handleProps(boundsCorners[(i + 2) % 4]!, (p, e) => {
      const ds = dragState.current!;
      scaleAround(axisScaleFromDrag(ds.anchorCanvas, ds.rotation, ds.start, p, ds.scale, e.shiftKey));
    });

  /** Edge drag: scales the perpendicular axis from the opposite edge (shift = uniform). */
  const edgeScale = (i: number, axis: "x" | "y") => {
    const a = boundsCorners[(i + 2) % 4]!;
    const b = boundsCorners[(i + 3) % 4]!;
    return handleProps(v2((a.x + b.x) / 2, (a.y + b.y) / 2), (p, e) => {
      const ds = dragState.current!;
      const sc = axisScaleFromDrag(ds.anchorCanvas, ds.rotation, ds.start, p, ds.scale, e.shiftKey);
      scaleAround(e.shiftKey ? sc : axis === "x" ? { ...ds.scale, x: sc.x } : { ...ds.scale, y: sc.y });
    });
  };

  // commit a transform of the selected control points (move or scale), keyed by their start
  // positions captured at drag-start so repeated moves don't compound
  const applyVertDrag = (transformLocal: (start: Vec2) => Vec2): void => {
    const d = vertDrag.current!;
    const byIndex = new Map(d.starts.map((s) => [s.i, s.p]));
    // snap the vertex's CANVAS position to the ½px grid (not its local coord), so it lands on
    // the grid the user sees regardless of the shape's scale/rotation
    const place = shape.gridSnap
      ? (local: Vec2): Vec2 => toLocal(shape.transform, snapVec(fromLocal(shape.transform, local)))
      : (local: Vec2): Vec2 => local;
    store.update(
      (doc2) =>
        updateShape(doc2, shape.id, (s) => ({
          ...s,
          controlPoints: s.controlPoints.map((cp, ci) => {
            const start = byIndex.get(ci);
            return start ? place(transformLocal(start)) : cp;
          }),
        })),
      { coalesce: `vgrp:${shape.id}` },
    );
  };

  const beginVertDrag = (e: React.PointerEvent, indices: number[], pivot: Vec2): void => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    vertDrag.current = {
      startCanvas: eventCanvasPoint(e),
      starts: indices.map((i) => ({ i, p: shape.controlPoints[i]! })),
      pivot,
    };
    setDraggingVert(true);
  };

  const vertEndProps = {
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      vertDrag.current = null;
      setDraggingVert(false);
      store.endGesture();
    },
  };

  // a vertex dot: shift-click toggles it in the selection; plain drag moves the selection
  // (selecting just this one first if it wasn't already selected)
  const vertexHandle = (i: number) => ({
    ...vertEndProps,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return; // right-click handled by onContextMenu
      if (e.shiftKey) {
        e.stopPropagation();
        setSelVerts((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
        return;
      }
      const group = selVerts.includes(i) ? selVerts : [i];
      if (!selVerts.includes(i)) setSelVerts([i]);
      beginVertDrag(e, group, v2(0, 0));
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!vertDrag.current) return;
      const d = toLocal(shape.transform, eventCanvasPoint(e));
      const s0 = toLocal(shape.transform, vertDrag.current.startCanvas);
      const dl = v2(d.x - s0.x, d.y - s0.y);
      applyVertDrag((start) => v2(start.x + dl.x, start.y + dl.y));
    },
  });

  // group-scale handle on the selection's bbox corner: scales selected verts about centroid
  const groupScaleHandle = (pivot: Vec2) => ({
    ...vertEndProps,
    onPointerDown: (e: React.PointerEvent) => beginVertDrag(e, selVerts, pivot),
    onPointerMove: (e: React.PointerEvent) => {
      if (!vertDrag.current) return;
      const factor = groupScaleFactor(
        vertDrag.current.pivot,
        toLocal(shape.transform, vertDrag.current.startCanvas),
        toLocal(shape.transform, eventCanvasPoint(e)),
      );
      applyVertDrag((start) => scalePointsAbout([start], vertDrag.current!.pivot, factor)[0]!);
    },
  });

  // --- context-menu operations (mirror the canvas verbs; all mesh-only) ---
  const opAddVertex = (ia: number, ib: number, t: number): void => {
    const newIndex = shape.controlPoints.length;
    store.update((d) =>
      updateShape(d, shape.id, (s) => {
        if (!s.mesh) return s;
        const r = splitEdge(s.controlPoints, s.mesh, ia, ib, t);
        return { ...s, controlPoints: r.controlPoints, mesh: r.mesh };
      }),
    );
    store.endGesture();
    setSelVerts([newIndex]);
  };
  const opConnect = (a: number, b: number): void => {
    store.update((d) =>
      updateShape(d, shape.id, (s) => {
        const t = s.mesh && connectVerts(s.controlPoints, s.mesh, a, b);
        return t ? { ...s, mesh: t } : s;
      }),
    );
    store.endGesture();
  };
  const opMerge = (verts: number[], keep: number): void => {
    store.update((d) =>
      updateShape(d, shape.id, (s) => {
        const r = s.mesh && mergeVerts(s.controlPoints, s.mesh, verts, keep);
        return r ? { ...s, controlPoints: r.controlPoints, mesh: r.mesh } : s;
      }),
    );
    store.endGesture();
    setSelVerts([]);
  };
  const opDeleteEdge = (ia: number, ib: number): void => {
    store.update((d) => updateShape(d, shape.id, (s) => (s.mesh ? { ...s, mesh: deleteEdge(s.mesh, ia, ib) } : s)));
    store.endGesture();
  };
  const opDelete = (verts: number[]): void => {
    store.update((d) =>
      updateShape(d, shape.id, (s) => {
        const r = s.mesh && deleteVerts(s.controlPoints, s.mesh, verts);
        return r ? { ...s, controlPoints: r.controlPoints, mesh: r.mesh } : s;
      }),
    );
    store.endGesture();
    setSelVerts([]);
  };
  const opZAlign = (target: number, plane: number[]): void => {
    store.update((d) =>
      updateShape(d, shape.id, (s) => {
        if (!s.mesh) return s;
        const z = alignVertToPlane(s.controlPoints, s.mesh.z, [plane[0]!, plane[1]!, plane[2]!], target);
        return z ? { ...s, mesh: { ...s.mesh, z } } : s;
      }),
    );
    store.endGesture();
  };

  const openVertexMenu = (i: number) => (e: React.MouseEvent): void => {
    if (!shape.mesh) return; // vertex verbs are mesh-only
    e.preventDefault();
    e.stopPropagation();
    // Z align: 3 selected (a face) + a connected 4th -> flatten both triangles onto one plane
    const neigh = neighborsOf(shape.mesh, i);
    if (selVerts.length === 3 && !selVerts.includes(i) && selVerts.filter((v) => neigh.has(v)).length >= 2) {
      setMenu({ x: e.clientX, y: e.clientY, verts: [i], target: i, zalign: { target: i, plane: selVerts }, edge: null });
      return;
    }
    const verts = selVerts.includes(i) ? selVerts : [i];
    if (!selVerts.includes(i)) setSelVerts(verts);
    setMenu({ x: e.clientX, y: e.clientY, verts, target: i, zalign: null, edge: null });
  };
  const openEdgeMenu = (ia: number, ib: number) => (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const p = toLocal(shape.transform, eventCanvasPoint(e));
    const a = shape.controlPoints[ia]!;
    const b = shape.controlPoints[ib]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
    setMenu({ x: e.clientX, y: e.clientY, verts: [], target: null, zalign: null, edge: { ia, ib, t } });
  };

  const menuItems = (m: NonNullable<typeof menu>): MenuEntry[] => {
    if (m.edge) {
      return [
        { label: "Add Vertex", onClick: () => opAddVertex(m.edge!.ia, m.edge!.ib, m.edge!.t) },
        "separator",
        { label: "Delete Edge", danger: true, onClick: () => opDeleteEdge(m.edge!.ia, m.edge!.ib) },
      ];
    }
    const items: MenuEntry[] = [];
    if (m.zalign) items.push({ label: "Z Align to Face", onClick: () => opZAlign(m.zalign!.target, m.zalign!.plane) });
    const v = m.verts;
    if (shape.mesh && v.length === 2) items.push({ label: "Connect Vertices", onClick: () => opConnect(v[0]!, v[1]!) });
    if (shape.mesh && v.length >= 2 && m.target !== null) {
      items.push({ label: "Merge Vertices", onClick: () => opMerge(v, m.target!) });
    }
    if (v.length >= 1) {
      if (items.length > 0) items.push("separator");
      items.push({ label: v.length === 1 ? "Delete Vertex" : "Delete Vertices", danger: true, onClick: () => opDelete(v) });
    }
    return items;
  };

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        {/* dark halo so handles survive white height maps and saturated normal maps */}
        <filter id="gizmo-halo" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#000000" floodOpacity="0.9" />
        </filter>
      </defs>
      <g filter="url(#gizmo-halo)">
      {/* oriented bounding box: rotates and shears with the shape's transform */}
      <polygon
        points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      {handles
        ? corners.map((c, i) => {
            /* invisible fat-stroke hit lines along the box edges: drag scales the
               perpendicular axis only. Corners render after, so they win hit priority. */
            const n = corners[(i + 1) % 4]!;
            const horizontal = Math.abs(n.x - c.x) > Math.abs(n.y - c.y);
            return (
              <line
                key={`edge${i}`}
                x1={c.x}
                y1={c.y}
                x2={n.x}
                y2={n.y}
                stroke="transparent"
                strokeWidth={10}
                className={`pointer-events-auto ${horizontal ? "cursor-ns-resize" : "cursor-ew-resize"}`}
                {...edgeScale(i, i % 2 === 0 ? "y" : "x")}
              />
            );
          })
        : null}
      {handles
        ? corners.map((c, i) => {
            /* scale: on the corner; per-axis, shift locks uniform. No rotate handles —
               godot select mode rotates via Ctrl-drag or the E tool, not corner widgets.
               Cursor diagonal follows the handle's direction off the box center (screen
               space, so rotation is accounted for): dx*dy > 0 = NW/SE, < 0 = NE/SW. */
            const cx = corners.reduce((a, k) => a + k.x, 0) / corners.length;
            const cy = corners.reduce((a, k) => a + k.y, 0) / corners.length;
            const nwse = (c.x - cx) * (c.y - cy) > 0;
            return (
              <rect
                key={i}
                x={c.x - 5}
                y={c.y - 5}
                width={10}
                height={10}
                fill="var(--color-accent)"
                className={`pointer-events-auto ${nwse ? "cursor-nwse-resize" : "cursor-nesw-resize"}`}
                {...cornerScale(i)}
              />
            );
          })
        : null}
      {/* group-scale frame: bbox of the selected vertices with corner handles (>=2 selected) */}
      {vertHandles && selVerts.length >= 2
        ? (() => {
            const sel = selVerts.map((i) => shape.controlPoints[i]!);
            const b = pointsBounds(sel);
            // pad the frame out from the dots (constant ~10 screen px) so corner handles
            // don't sit on top of the vertices and stay grabbable
            const gp = (PAD + 4) / Math.max(0.0001, (Math.abs(shape.transform.scale.x) + Math.abs(shape.transform.scale.y)) / 2);
            const cl = [
              v2(b.min.x - gp, b.min.y - gp),
              v2(b.max.x + gp, b.min.y - gp),
              v2(b.max.x + gp, b.max.y + gp),
              v2(b.min.x - gp, b.max.y + gp),
            ];
            const cc = cl.map((c) => canvasToScreen(viewport, localToCanvas(shape, c)));
            return (
              <>
                <polygon
                  points={cc.map((c) => `${c.x},${c.y}`).join(" ")}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  opacity={0.8}
                />
                {cc.map((c, i) => (
                  <rect
                    key={`gs${i}`}
                    x={c.x - 4}
                    y={c.y - 4}
                    width={8}
                    height={8}
                    fill="var(--color-accent)"
                    className="pointer-events-auto cursor-nwse-resize"
                    {...groupScaleHandle(b.centroid)}
                  />
                ))}
              </>
            );
          })()
        : null}
      {vertHandles && getShapeType(shape.typeId).controlPoints.kind !== "none"
        ? (() => {
            const kind = getShapeType(shape.typeId).controlPoints.kind;
            const pts = shape.controlPoints.map((cp) => canvasToScreen(viewport, localToCanvas(shape, cp)));
            // while dragging a vertex, an edge aligned to a 45° axis (within ¼px on the canvas
            // grid — points are screen-space, so scale the tol by zoom) lights bright white + thick
            const alignTol = 0.25 * viewport.zoom;
            const seg = (a: Vec2, b: Vec2, key: string, dashed?: boolean): React.JSX.Element => {
              const on = draggingVert && alignedToAxis(a, b, alignTol);
              return (
                <line
                  key={key}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={on ? "#ffffff" : "var(--color-accent)"}
                  strokeWidth={on ? 3 : 1}
                  opacity={on ? 1 : 0.6}
                  strokeDasharray={dashed ? "3 3" : undefined}
                />
              );
            };
            const lines: React.JSX.Element[] = [];
            if (kind === "rings") {
              const split = shape.ringSplit ?? (pts.length >> 1);
              const outer = pts.slice(0, split);
              const inner = pts.slice(split);
              outer.forEach((p, i) => lines.push(seg(p, outer[(i + 1) % outer.length]!, `o${i}`)));
              inner.forEach((p, i) => lines.push(seg(p, inner[(i + 1) % inner.length]!, `i${i}`)));
              // the actual strip diagonals — what the slope is triangulated along (any counts)
              frustumStrip(outer.length, inner.length).connectors.forEach(([oi, ii], k) =>
                lines.push(seg(outer[oi]!, inner[ii]!, `c${k}`, true)),
              );
            } else if (kind === "polygon") {
              pts.forEach((p, i) => lines.push(seg(p, pts[(i + 1) % pts.length]!, `p${i}`)));
            } else if (kind === "mesh" && shape.mesh) {
              // mesh edges: the octant-lit line + a fat transparent hit-line (click to add a vertex)
              for (const [ia, ib] of meshEdges(shape.mesh)) {
                const a = pts[ia]!;
                const b = pts[ib]!;
                lines.push(seg(a, b, `m${ia}_${ib}`));
                lines.push(
                  <line
                    key={`mh${ia}_${ib}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth={9}
                    className="pointer-events-auto cursor-context-menu"
                    onContextMenu={openEdgeMenu(ia, ib)}
                  />,
                );
              }
            } else {
              for (let i = 0; i + 1 < pts.length; i++) lines.push(seg(pts[i]!, pts[i + 1]!, `l${i}`));
            }
            return <g className="pointer-events-none">{lines}</g>;
          })()
        : null}
      {vertHandles &&
        shape.controlPoints.map((cp, i) => {
          const sp = canvasToScreen(viewport, localToCanvas(shape, cp));
          const selected = selVerts.includes(i);
          return (
            <circle
              key={i}
              cx={sp.x}
              cy={sp.y}
              r={5}
              fill={selected ? "var(--color-accent)" : "#ffffff"}
              stroke={selected ? "#ffffff" : "var(--color-accent)"}
              strokeWidth={1.5}
              className="pointer-events-auto cursor-move"
              {...vertexHandle(i)}
              onContextMenu={openVertexMenu(i)}
            />
          );
        })}
      </g>
      </svg>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
