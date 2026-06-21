import { useRef, useState } from "react";
import type { DocumentStore } from "../document/store";
import { removeShapeVertices, updateShape } from "../document/docOps";
import { findNode, findParentId, nodeWorldAffine } from "../document/layerOps";
import type { LambertDoc } from "../document/schema";
import { affineApply, affineCompose, affineFromTRS, affineIdentity, affineInvert } from "../field/affine";

import { frustumStrip, insertVertex } from "../field/controlPoints";
import { BezierAnchor, bezierSpine, nearestOnSpine, resolveHandles, splitSegment } from "../field/bezier";
import { dragHandle, movePoint, toggleMode } from "../field/bezierEdit";
import { CABLE_SUB } from "../field/shapes/cable";
import {
  alignVertToPlane,
  connectVerts,
  deleteEdge,
  mergeVerts,
  meshEdges,
  neighborsOf,
  splitEdge,
} from "../field/meshOps";
import { getShapeType } from "../field/registry";
import { alignedToAxis } from "../field/snap";
import { snapCanvasPoint } from "./snapPoint";
import { fromLocal } from "../field/transform";
import { isGroup, isShape, type ShapeInstance } from "../field/types";
import { GroupGizmo } from "./GroupGizmo";
import { MaskGizmo } from "./MaskGizmo";
import { localBounds } from "./shapeBounds";
import { Vector2, Vector3 } from "@carapace/primitives";
import { v2 } from "../field/vec";
import { ContextMenu, MenuEntry } from "./kit";
import { axisScaleFromDrag, groupScaleFactor, pointsBounds, rotationFromDrag, scalePointsAbout, snapAngle } from "./picking";
import type { Placing, ToolMode } from "./tools";
import { canvasToScreen, screenToCanvas, Viewport } from "./viewport";

const ROTATE_SNAP = Math.PI / 12; // 15deg; Shift snaps rotation to this step

/** Forward of toLocal: scale THEN rotate, then translate (pinned by picking.test.ts). */
const localToCanvas = (s: ShapeInstance, cp: Vector2): Vector2 => fromLocal(s.transform, cp);

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
  /** Enter click-to-place mode (CanvasView owns the cursor tracking + commit click). */
  setPlacing: (p: Placing | null) => void;
  /** Global ½px grid snap (vertices, polygon + curve points). */
  snap: boolean;
}): React.JSX.Element | null {
  const { doc, selectedId, viewport, store, tool, selVerts, setSelVerts, setPlacing, snap } = props;
  // grid + guide snap for any world point being edited (no-op when both toggles are off)
  const snapPt = (p: Vector2): Vector2 =>
    snapCanvasPoint(p, { grid: snap, guides: doc.canvas.snapToGuides, guideLines: doc.canvas.guides, zoom: viewport.zoom });
  const selNode = selectedId ? findNode(doc.layers, selectedId) : null;
  const unlocked = !selNode?.locked;
  const handles = tool === "select" && unlocked; // shape transform handles (corners/edges)
  const vertHandles = (tool === "select" || tool === "vertex") && unlocked; // vertex dots + group
  const bezierDrag = useRef<{ kind: "point" | "in" | "out"; i: number } | null>(null); // cable pen edit
  const dragState = useRef<{
    start: Vector2;
    rotation: number;
    scale: Vector3;
    pos: Vector3;
    /** Fixed point the scale pivots about (the opposite corner/edge, or centre with Ctrl), local + canvas. */
    anchorLocal: Vector2;
    anchorCanvas: Vector2;
    /** Modifier state at the last (re)baseline — a toggle mid-drag re-baselines so it takes effect live. */
    shift: boolean;
    ctrl: boolean;
  } | null>(null);
  const rotDrag = useRef<{ start: Vector2; startRotation: number; pivot: Vector2 } | null>(null);
  // multi-vertex selection lives in CanvasView; this is the move/scale drag state
  const vertDrag = useRef<{ startCanvas: Vector2; starts: { i: number; p: Vector2 }[]; pivot: Vector2 } | null>(null);
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
  const [cableMenu, setCableMenu] = useState<{ x: number; y: number; i: number } | null>(null);
  const shape = selNode && isShape(selNode) ? selNode : undefined;
  if (!shape) {
    // a group has no shape body — render its transform gizmo + its mask editor (edit anchors on canvas)
    if (!selNode || !isGroup(selNode)) return null;
    return (
      <>
        <GroupGizmo group={selNode} viewport={viewport} store={store} doc={doc} />
        {unlocked && selNode.masks?.length ? (
          <MaskGizmo nodeId={selNode.id} masks={selNode.masks} doc={doc} viewport={viewport} snap={snap} store={store} />
        ) : null}
      </>
    );
  }

  // resolve the shape's frames so the gizmo overlay + editing line up with the FIELD even when the
  // shape is nested in groups. parentAffine = the shape's parent frame (local TRS edits live in it);
  // worldAffine = full local->world. For a top-level shape parentAffine is identity and worldAffine
  // equals fromLocal(shape.transform), so all of this reduces to the original (unchanged) behaviour.
  const parentId = findParentId(doc.layers, shape.id) ?? null;
  const parentAffine = parentId ? (nodeWorldAffine(doc.layers, parentId) ?? affineIdentity()) : affineIdentity();
  const invParent = affineInvert(parentAffine);
  const worldAffine = affineCompose(parentAffine, affineFromTRS(shape.transform));
  const invWorld = affineInvert(worldAffine);
  /** shape-local point -> screen px (through every ancestor group). */
  const toScreen = (localPt: Vector2): Vector2 => canvasToScreen(viewport, affineApply(worldAffine, localPt));
  /** world/canvas point -> shape-local (inverse of the full chain). */
  const w2l = (worldPt: Vector2): Vector2 => affineApply(invWorld, worldPt);

  const bounds = localBounds(shape);
  const pad = PAD / Math.max(0.0001, (Math.abs(shape.transform.scale.x) + Math.abs(shape.transform.scale.y)) / 2);
  const cornersLocal = [
    v2(bounds.min.x - pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.max.y + pad),
    v2(bounds.min.x - pad, bounds.max.y + pad),
  ];
  const corners = cornersLocal.map((c) => toScreen(c));
  // footprint corners (no pad): stable during a scale drag, used as scale anchors
  const boundsCorners = [
    v2(bounds.min.x, bounds.min.y),
    v2(bounds.max.x, bounds.min.y),
    v2(bounds.max.x, bounds.max.y),
    v2(bounds.min.x, bounds.max.y),
  ];
  const boundsCenter = v2((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2);

  const eventCanvasPoint = (e: React.MouseEvent): Vector2 => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };
  // the transform handles edit the shape's LOCAL TRS, which lives in the PARENT frame — so their drag
  // math runs in parent-local coords. (identity parent => same as the world event point.)
  const eventParent = (e: React.MouseEvent): Vector2 => affineApply(invParent, eventCanvasPoint(e));

  // anchorFor picks the pinned point: normally the opposite corner/edge, but the centre when Ctrl
  // is held (scale-from-centre). Re-evaluated when a modifier toggles mid-drag (see onPointerMove).
  const begin = (anchorFor: (e: React.PointerEvent) => Vector2) => (e: React.PointerEvent): void => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const anchorLocal = anchorFor(e);
    dragState.current = {
      start: eventParent(e),
      rotation: shape.transform.rotation,
      scale: shape.transform.scale,
      pos: shape.transform.pos,
      anchorLocal,
      anchorCanvas: localToCanvas(shape, anchorLocal),
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
    };
  };

  const handleProps = (anchorFor: (e: React.PointerEvent) => Vector2, apply: (p: Vector2, e: React.PointerEvent) => void) => ({
    onPointerDown: begin(anchorFor),
    onPointerMove: (e: React.PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      // Shift (uniform) / Ctrl (from-centre) toggled mid-drag: re-baseline from the CURRENT state so
      // the new mode takes effect immediately and seamlessly (no jump), not just from the next drag.
      if (e.shiftKey !== ds.shift || e.ctrlKey !== ds.ctrl) {
        ds.shift = e.shiftKey;
        ds.ctrl = e.ctrlKey;
        ds.start = eventParent(e);
        ds.scale = shape.transform.scale;
        ds.pos = shape.transform.pos;
        ds.anchorLocal = anchorFor(e);
        ds.anchorCanvas = localToCanvas(shape, ds.anchorLocal);
      }
      apply(eventParent(e), e);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      dragState.current = null;
      store.endGesture();
    },
  });

  /** Apply a new scale while pinning the drag anchor (opposite corner/edge) in place. */
  const scaleAround = (sc: Vector3): void => {
    const ds = dragState.current!;
    const c = Math.cos(ds.rotation);
    const s = Math.sin(ds.rotation);
    const rx = ds.anchorLocal.x * sc.x;
    const ry = ds.anchorLocal.y * sc.y;
    // pos shifts so anchorLocal still lands on anchorCanvas under the new scale
    const pos = new Vector3(ds.anchorCanvas.x - (rx * c - ry * s), ds.anchorCanvas.y - (rx * s + ry * c), ds.pos.z);
    store.update(
      (d) => updateShape(d, shape.id, (sh) => ({ ...sh, transform: { ...sh.transform, scale: sc, pos } })),
      { coalesce: `scale:${shape.id}` },
    );
  };

  /** Corner drag: scales both footprint axes from the opposite corner (Shift = uniform, Ctrl = from centre). */
  const cornerScale = (i: number) =>
    handleProps(
      (e) => (e.ctrlKey ? boundsCenter : boundsCorners[(i + 2) % 4]!),
      (p, e) => {
        const ds = dragState.current!;
        scaleAround(axisScaleFromDrag(ds.anchorCanvas, ds.rotation, ds.start, p, ds.scale, e.shiftKey));
      },
    );

  /** Edge drag: scales the perpendicular axis from the opposite edge (Shift = uniform, Ctrl = from centre). */
  const edgeScale = (i: number, axis: "x" | "y") => {
    const a = boundsCorners[(i + 2) % 4]!;
    const b = boundsCorners[(i + 3) % 4]!;
    const oppositeMid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
    return handleProps(
      (e) => (e.ctrlKey ? boundsCenter : oppositeMid),
      (p, e) => {
        const ds = dragState.current!;
        const sc = axisScaleFromDrag(ds.anchorCanvas, ds.rotation, ds.start, p, ds.scale, e.shiftKey);
        scaleAround(e.shiftKey ? sc : axis === "x" ? ds.scale.withX(sc.x) : ds.scale.withY(sc.y));
      },
    );
  };

  /** Rotate handle: drag an arm extending from an edge to spin the shape about its pivot (Shift = 15°). */
  const rotateHandle = () => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      rotDrag.current = {
        start: eventParent(e),
        startRotation: shape.transform.rotation,
        pivot: v2(shape.transform.pos.x, shape.transform.pos.y),
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const rd = rotDrag.current;
      if (!rd) return;
      let rot = rotationFromDrag(rd.pivot, rd.start, eventParent(e), rd.startRotation);
      if (e.shiftKey) rot = snapAngle(rot, ROTATE_SNAP);
      store.update((d) => updateShape(d, shape.id, (s) => ({ ...s, transform: { ...s.transform, rotation: rot } })), {
        coalesce: `rot:${shape.id}`,
      });
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      rotDrag.current = null;
      store.endGesture();
    },
  });

  // commit a transform of the selected control points (move or scale), keyed by their start
  // positions captured at drag-start so repeated moves don't compound
  const applyVertDrag = (transformLocal: (start: Vector2) => Vector2): void => {
    const d = vertDrag.current!;
    const byIndex = new Map(d.starts.map((s) => [s.i, s.p]));
    // snap the vertex's CANVAS position (not its local coord), so it lands on the grid / guides
    // the user sees regardless of the shape's scale/rotation
    const place = (local: Vector2): Vector2 => w2l(snapPt(affineApply(worldAffine, local)));
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

  const beginVertDrag = (e: React.PointerEvent, indices: number[], pivot: Vector2): void => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
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
      const d = w2l(eventCanvasPoint(e));
      const s0 = w2l(vertDrag.current.startCanvas);
      const dl = v2(d.x - s0.x, d.y - s0.y);
      applyVertDrag((start) => v2(start.x + dl.x, start.y + dl.y));
    },
  });

  // group-scale handle on the selection's bbox corner: scales selected verts about centroid
  const groupScaleHandle = (pivot: Vector2) => ({
    ...vertEndProps,
    onPointerDown: (e: React.PointerEvent) => beginVertDrag(e, selVerts, pivot),
    onPointerMove: (e: React.PointerEvent) => {
      if (!vertDrag.current) return;
      const factor = groupScaleFactor(
        vertDrag.current.pivot,
        w2l(vertDrag.current.startCanvas),
        w2l(eventCanvasPoint(e)),
      );
      applyVertDrag((start) => scalePointsAbout([start], vertDrag.current!.pivot, factor)[0]!);
    },
  });

  // --- context-menu / edit operations ---
  // insert a vertex on edge (ia,ib) at parameter t. Mesh splits the edge (new tris); polygon/
  // polyline/ring splice a point between ia and ib (rings bump ringSplit when the edge is outer).
  const opAddVertex = (ia: number, ib: number, t: number): void => {
    const newIndex = shape.mesh ? shape.controlPoints.length : ia + 1;
    store.update((d) =>
      updateShape(d, shape.id, (s) => {
        if (s.mesh) {
          const r = splitEdge(s.controlPoints, s.mesh, ia, ib, t);
          return { ...s, controlPoints: r.controlPoints, mesh: r.mesh };
        }
        const a = s.controlPoints[ia]!;
        const b = s.controlPoints[ib]!;
        const cps = insertVertex(s.controlPoints, ia, v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
        if (getShapeType(s.typeId).controlPoints.kind === "rings") {
          const split = s.ringSplit ?? (s.controlPoints.length >> 1);
          return { ...s, controlPoints: cps, ringSplit: ia < split ? split + 1 : split };
        }
        return { ...s, controlPoints: cps };
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
    store.update((d) => updateShape(d, shape.id, (s) => removeShapeVertices(s, verts)));
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
    e.preventDefault();
    e.stopPropagation();
    // Z align (mesh only): 3 selected (a face) + a connected 4th -> flatten both tris onto one plane
    if (shape.mesh) {
      const neigh = neighborsOf(shape.mesh, i);
      if (selVerts.length === 3 && !selVerts.includes(i) && selVerts.filter((v) => neigh.has(v)).length >= 2) {
        setMenu({ x: e.clientX, y: e.clientY, verts: [i], target: i, zalign: { target: i, plane: selVerts }, edge: null });
        return;
      }
    }
    const verts = selVerts.includes(i) ? selVerts : [i];
    if (!selVerts.includes(i)) setSelVerts(verts);
    setMenu({ x: e.clientX, y: e.clientY, verts, target: i, zalign: null, edge: null });
  };
  // parameter t of the cursor projected onto edge (ia,ib), clamped to the segment
  const edgeT = (ia: number, ib: number, e: React.MouseEvent): number => {
    const p = w2l(eventCanvasPoint(e));
    const a = shape.controlPoints[ia]!;
    const b = shape.controlPoints[ib]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    return Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
  };
  const openEdgeMenu = (ia: number, ib: number) => (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, verts: [], target: null, zalign: null, edge: { ia, ib, t: edgeT(ia, ib, e) } });
  };
  // Alt-click an edge inserts a vertex there inline (no menu); the new vertex is selected
  const insertOnEdge = (ia: number, ib: number) => (e: React.PointerEvent): void => {
    if (e.button !== 0 || !e.altKey) return;
    e.stopPropagation();
    opAddVertex(ia, ib, edgeT(ia, ib, e));
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
    const kind = getShapeType(shape.typeId).controlPoints.kind;
    if (m.target !== null && (kind === "polygon" || kind === "polyline")) {
      // click-to-place a new vertex extending from this one (rubber-band, chains until Esc)
      items.push({ label: "New Vertex", onClick: () => setPlacing({ kind: "vertex", shapeId: shape.id, afterIndex: m.target! }) });
    }
    if (v.length >= 1) {
      if (items.length > 0) items.push("separator");
      items.push({ label: v.length === 1 ? "Delete Vertex" : "Delete Vertices", danger: true, hotkey: "⌫", onClick: () => opDelete(v) });
    }
    return items;
  };

  // cable Bézier editing
  const isCable = shape.typeId === "cable" && !!shape.bezier;
  const commitBezier = (next: BezierAnchor[], coalesce: string): void => {
    // unbaked: only the path is stored; the fold samples it directly (no controlPoints)
    store.update((d) => updateShape(d, shape.id, (sh) => ({ ...sh, bezier: next })), { coalesce });
  };
  // toggle smooth<->corner: going manual bakes the current resolved tangents (no visual jump);
  // going smooth clears them so resolveHandles takes over again
  const toggleAnchorMode = (i: number): void => {
    commitBezier(toggleMode(shape.bezier!, i), `mode:${shape.id}`);
    store.endGesture();
  };
  const toggleAnchorSym = (i: number): void => {
    commitBezier(shape.bezier!.map((a, idx) => (idx === i ? { ...a, sym: a.sym === false } : a)), `sym:${shape.id}`);
    store.endGesture();
  };
  const deleteAnchor = (i: number): void => {
    const b = shape.bezier!;
    if (b.length <= 2) return; // a cable needs >= 2 anchors
    commitBezier(
      b.filter((_, idx) => idx !== i),
      `del:${shape.id}`,
    );
    store.endGesture();
  };
  const cableMenuItems = (i: number): MenuEntry[] => {
    const b = shape.bezier!;
    const items: MenuEntry[] = [];
    if (i === 0 || i === b.length - 1) {
      items.push({ label: "Extend Cable", onClick: () => setPlacing({ kind: "cable-end", shapeId: shape.id, end: i === 0 ? "start" : "end" }) });
    }
    items.push({ label: isCorner(b[i]!) ? "Make Smooth" : "Make Corner", onClick: () => toggleAnchorMode(i) });
    if (!isCorner(b[i]!)) {
      items.push({ label: b[i]!.sym === false ? "Make Tangents Symmetric" : "Make Tangents Independent", onClick: () => toggleAnchorSym(i) });
    }
    if (b.length > 2) {
      items.push("separator", { label: "Delete Vertex", danger: true, hotkey: "⌫", onClick: () => deleteAnchor(i) });
    }
    return items;
  };
  // drag handlers for a vertex point / its in / out tangent handle (mirror on plain drag, Alt breaks)
  const bezierHandleProps = (kind: "point" | "in" | "out", i: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      bezierDrag.current = { kind, i };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const drag = bezierDrag.current;
      if (!drag || !shape.bezier) return;
      const canvasPt = eventCanvasPoint(e);
      if (drag.kind === "point") {
        // snap the anchor's CANVAS position (grid + guides), like control-point vertices
        const local = w2l(snapPt(canvasPt));
        commitBezier(movePoint(shape.bezier, drag.i, local, e.altKey), `bez:${shape.id}`);
        return;
      }
      // tangent drag: symmetric per the anchor's sym flag, Alt inverts it; Shift snaps the angle to 15deg.
      // Bake the dragged anchor's RESOLVED tangents first (smooth->manual) so an independent drag keeps
      // the OTHER tangent at its auto-derived value instead of the stored zero (which would vanish).
      const local = w2l(canvasPt);
      const r = resolveHandles(shape.bezier)[drag.i]!;
      const based = shape.bezier.map((a, idx) => (idx === drag.i ? { ...a, hIn: r.hIn, hOut: r.hOut, mode: "manual" as const } : a));
      const sym = shape.bezier[drag.i]!.sym !== false;
      const next = dragHandle(based, drag.i, drag.kind, local, sym !== e.altKey, e.shiftKey ? ROTATE_SNAP : undefined);
      commitBezier(next, `bez:${shape.id}`);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      bezierDrag.current = null;
      store.endGesture();
    },
  });
  // click on the curve inserts an anchor WITHOUT changing the curve (de Casteljau split on the
  // resolved path). The three touched anchors are pinned manual so resolveHandles won't re-smooth
  // them and undo the split. The new anchor is selected so Delete/arrows act on it.
  const insertOnCurve = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !shape.bezier) return;
    e.stopPropagation();
    const near = nearestOnSpine(shape.bezier, w2l(eventCanvasPoint(e)));
    if (!near) return;
    const split = splitSegment(resolveHandles(shape.bezier), near.seg, near.t);
    const next = split.map((a, idx) =>
      idx >= near.seg && idx <= near.seg + 2 ? { ...a, mode: "manual" as const } : a,
    );
    setSelVerts([near.seg + 1]);
    commitBezier(next, `ins:${shape.id}`);
    store.endGesture();
  };
  const bezScreen = (local: Vector2): Vector2 => toScreen(local);

  // a corner = manual anchor with zero-length handles: it has no tangents, so tangent-symmetry verbs
  // are meaningless for it (a smooth anchor DOES have meaningful sym — its auto-tangent gets dragged).
  const isCorner = (a: BezierAnchor): boolean =>
    a.mode === "manual" && a.hIn.x === 0 && a.hIn.y === 0 && a.hOut.x === 0 && a.hOut.y === 0;

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
      {/* cable Bézier pen: clickable curve (insert), tangent stalks, vertex + handle dots */}
      {isCable && vertHandles ? (
        <>
          {(() => {
            const pts = bezierSpine(shape.bezier!, CABLE_SUB).map((cp) => { const s = bezScreen(cp); return `${s.x},${s.y}`; }).join(" ");
            return (
              <>
                {/* visible centreline (not interactive) so the whole cable path reads at a glance */}
                <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeOpacity={0.85} style={{ pointerEvents: "none" }} />
                {/* fat invisible hit strip: click anywhere along the path to insert an anchor */}
                <polyline points={pts} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke", cursor: "copy" }} onPointerDown={insertOnCurve} />
              </>
            );
          })()}
          {resolveHandles(shape.bezier!).map((a, i) => {
            const pS = bezScreen(a.p);
            const hasOut = a.hOut.x !== 0 || a.hOut.y !== 0;
            const hasIn = a.hIn.x !== 0 || a.hIn.y !== 0;
            const outS = bezScreen(v2(a.p.x + a.hOut.x, a.p.y + a.hOut.y));
            const inS = bezScreen(v2(a.p.x + a.hIn.x, a.p.y + a.hIn.y));
            return (
              <g key={`bz-${i}`}>
                {hasOut ? <line x1={pS.x} y1={pS.y} x2={outS.x} y2={outS.y} stroke="var(--color-accent)" strokeWidth={1} strokeOpacity={0.6} /> : null}
                {hasIn ? <line x1={pS.x} y1={pS.y} x2={inS.x} y2={inS.y} stroke="var(--color-accent)" strokeWidth={1} strokeOpacity={0.6} /> : null}
                {hasOut ? (
                  <g {...bezierHandleProps("out", i)} style={{ cursor: "move" }}>
                    <circle cx={outS.x} cy={outS.y} r={11} fill="transparent" style={{ pointerEvents: "auto" }} />
                    <circle cx={outS.x} cy={outS.y} r={4} fill="#191a1b" stroke="var(--color-accent)" strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                  </g>
                ) : null}
                {hasIn ? (
                  <g {...bezierHandleProps("in", i)} style={{ cursor: "move" }}>
                    <circle cx={inS.x} cy={inS.y} r={11} fill="transparent" style={{ pointerEvents: "auto" }} />
                    <circle cx={inS.x} cy={inS.y} r={4} fill="#191a1b" stroke="var(--color-accent)" strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                  </g>
                ) : null}
                {(() => {
                  const pointProps = bezierHandleProps("point", i);
                  const corner = isCorner(shape.bezier![i]!); // diamond only for a true corner (no tangents)
                  const sel = selVerts.includes(i);
                  const stroke = sel ? "#ffffff" : "#191a1b";
                  return (
                    <g
                      style={{ cursor: "move" }}
                      onPointerDown={(e) => {
                        if (e.button === 0 && e.shiftKey) {
                          // Shift-toggle into a multi-selection (so the multi-anchor Delete is reachable)
                          e.stopPropagation();
                          setSelVerts((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
                          return;
                        }
                        setSelVerts([i]); // select this anchor so Delete/arrows target it
                        pointProps.onPointerDown(e);
                      }}
                      onPointerMove={pointProps.onPointerMove}
                      onPointerUp={pointProps.onPointerUp}
                      onContextMenu={(e) => {
                        // right-click an anchor -> menu (Extend on ends, Make Smooth/Corner, Delete)
                        e.preventDefault();
                        e.stopPropagation();
                        setCableMenu({ x: e.clientX, y: e.clientY, i });
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
                          fill="var(--color-accent)"
                          stroke={stroke}
                          strokeWidth={1.5}
                          style={{ pointerEvents: "none" }}
                        />
                      ) : (
                        <circle cx={pS.x} cy={pS.y} r={5} fill="var(--color-accent)" stroke={stroke} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                      )}
                    </g>
                  );
                })()}
              </g>
            );
          })}
        </>
      ) : null}
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
      {/* rotate handles: a short arm + knob extending outward from each edge midpoint */}
      {handles
        ? corners.map((c, i) => {
            const n = corners[(i + 1) % 4]!;
            const mid = v2((c.x + n.x) / 2, (c.y + n.y) / 2);
            const cx = corners.reduce((a, k) => a + k.x, 0) / corners.length;
            const cy = corners.reduce((a, k) => a + k.y, 0) / corners.length;
            let ox = mid.x - cx;
            let oy = mid.y - cy;
            const ol = Math.hypot(ox, oy) || 1;
            ox /= ol;
            oy /= ol;
            const knob = v2(mid.x + ox * 20, mid.y + oy * 20);
            return (
              <g key={`rot${i}`}>
                <line x1={mid.x} y1={mid.y} x2={knob.x} y2={knob.y} stroke="var(--color-accent)" strokeWidth={1} strokeOpacity={0.6} />
                <circle cx={knob.x} cy={knob.y} r={10} fill="transparent" className="pointer-events-auto cursor-rotate" {...rotateHandle()} />
                <circle cx={knob.x} cy={knob.y} r={4} fill="#191a1b" stroke="var(--color-accent)" strokeWidth={1.5} className="pointer-events-none" />
              </g>
            );
          })
        : null}
      {handles
        ? corners.map((c, i) => {
            /* scale: on the corner; per-axis, Shift locks uniform, Ctrl scales from centre.
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
      {/* group-scale frame: bbox of the selected vertices with corner handles (>=2 selected).
          Gated to control-point shapes (a cable has none — selVerts there are anchor indices) and
          filtered for stale indices: switching shapes re-renders with the new shape but the previous
          selection before the clearing effect runs, so an index may be out of range for one frame. */}
      {vertHandles && getShapeType(shape.typeId).controlPoints.kind !== "none" && selVerts.length >= 2
        ? (() => {
            const sel = selVerts.map((i) => shape.controlPoints[i]).filter((p): p is Vector2 => p !== undefined);
            if (sel.length < 2) return null;
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
            const cc = cl.map((c) => toScreen(c));
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
            const pts = shape.controlPoints.map((cp) => toScreen(cp));
            // while dragging a vertex, an edge aligned to a 45° axis (within ¼px on the canvas
            // grid — points are screen-space, so scale the tol by zoom) lights bright white + thick
            const alignTol = 0.25 * viewport.zoom;
            const seg = (a: Vector2, b: Vector2, key: string, dashed?: boolean): React.JSX.Element => {
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
            // fat transparent hit-line over a real edge (ia,ib): right-click for the menu,
            // Alt-click to insert a vertex inline. Lives over the visible seg() line.
            const edgeHit = (ia: number, ib: number, a: Vector2, b: Vector2, key: string): React.JSX.Element => (
              <line
                key={key}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={9}
                className="pointer-events-auto cursor-copy"
                onPointerDown={insertOnEdge(ia, ib)}
                onContextMenu={openEdgeMenu(ia, ib)}
              />
            );
            const lines: React.JSX.Element[] = [];
            if (kind === "rings") {
              const split = shape.ringSplit ?? (pts.length >> 1);
              const outer = pts.slice(0, split);
              const inner = pts.slice(split);
              outer.forEach((p, i) => {
                const j = (i + 1) % outer.length;
                lines.push(seg(p, outer[j]!, `o${i}`), edgeHit(i, j, p, outer[j]!, `oh${i}`));
              });
              inner.forEach((p, i) => {
                const j = (i + 1) % inner.length;
                lines.push(seg(p, inner[j]!, `i${i}`), edgeHit(split + i, split + j, p, inner[j]!, `ih${i}`));
              });
              // the actual strip diagonals — what the slope is triangulated along (any counts)
              frustumStrip(outer.length, inner.length).connectors.forEach(([oi, ii], k) =>
                lines.push(seg(outer[oi]!, inner[ii]!, `c${k}`, true)),
              );
            } else if (kind === "polygon") {
              pts.forEach((p, i) => {
                const j = (i + 1) % pts.length;
                lines.push(seg(p, pts[j]!, `p${i}`), edgeHit(i, j, p, pts[j]!, `ph${i}`));
              });
            } else if (kind === "mesh" && shape.mesh) {
              // mesh edges: the octant-lit line + a fat hit-line (right-click menu / Alt-click insert)
              for (const [ia, ib] of meshEdges(shape.mesh)) {
                const a = pts[ia]!;
                const b = pts[ib]!;
                lines.push(seg(a, b, `m${ia}_${ib}`), edgeHit(ia, ib, a, b, `mh${ia}_${ib}`));
              }
            } else if (kind === "polyline") {
              for (let i = 0; i + 1 < pts.length; i++) {
                lines.push(seg(pts[i]!, pts[i + 1]!, `l${i}`), edgeHit(i, i + 1, pts[i]!, pts[i + 1]!, `lh${i}`));
              }
            } else {
              for (let i = 0; i + 1 < pts.length; i++) lines.push(seg(pts[i]!, pts[i + 1]!, `l${i}`));
            }
            return <g className="pointer-events-none">{lines}</g>;
          })()
        : null}
      {vertHandles &&
        shape.controlPoints.map((cp, i) => {
          const sp = toScreen(cp);
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
      {cableMenu ? (
        <ContextMenu x={cableMenu.x} y={cableMenu.y} items={cableMenuItems(cableMenu.i)} onClose={() => setCableMenu(null)} />
      ) : null}
      {vertHandles && shape.masks?.length ? (
        <MaskGizmo nodeId={shape.id} masks={shape.masks} doc={doc} viewport={viewport} snap={snap} store={store} />
      ) : null}
    </>
  );
}
