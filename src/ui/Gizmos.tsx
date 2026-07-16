import { memo, useState } from "react";
import type { DocumentStore } from "../document/store";
import { removeObjectVertices, updateObject } from "../document/docOps";
import { findNode, nodeFrames } from "../document/layerOps";
import type { LambertDoc } from "../document/schema";
import { affineApply } from "../field/affine";

import { insertVertex } from "../field/controlPoints";
import { bakeRings, bezierAnchor, BezierAnchor, bezierSpine, insertOnPath, nearestOnPath, resolvePath, splitSubpaths } from "../field/bezier";
import { applyBezierEdit, dragHandle, isCornerAnchor as isCorner, movePoint } from "../field/bezierEdit";
import {
  alignVertToPlane,
  connectVerts,
  deleteEdge,
  mergeVerts,
  meshEdges,
  neighborsOf,
  splitEdge,
} from "../field/meshOps";
import { getObjectType, ObjectTypeId } from "../field/registry";
import { alignedToAxis } from "../field/snap";
import { editSnap } from "./snapPoint";
import { fromLocal } from "../field/transform";
import { isGroup, isObject, type ObjectInstance } from "../field/types";
import { GroupGizmo } from "./GroupGizmo";
import { MaskGizmo } from "./MaskGizmo";
import { localBounds, paddedCorners } from "../field/objectBounds";
import { Vector2, Vector3 } from "@carapace/primitives";
import { v2 } from "../field/vec";
import { ContextMenu, MenuEntry } from "./kit";
import { axisScaleFromDrag, constrainAxis, grabGroup, rotationFromDrag, ROTATE_SNAP, snapAngle, toggleIndex } from "./picking";
import type { Placing, ToolMode } from "./tools";
import { canvasToScreen, Viewport } from "./viewport";
import { eventToCanvas } from "./canvasCoords";
import { HANDLE_DRAG_PX, usePointerDrag } from "./usePointerDrag";
import { AnchorHandles, CornerHandles, GizmoHalo, RotateKnobs } from "./gizmoChrome";

/** Forward of toLocal: scale THEN rotate, then translate (pinned by picking.test.ts). */
const localToCanvas = (s: ObjectInstance, cp: Vector2): Vector2 => fromLocal(s.transform, cp);

/** The object transform-handle drag snapshot (corner/edge scale + rotate baseline). */
interface DragSnap {
  start: Vector2;
  /** Pointer position at the PRESS — the baseline a mid-drag modifier toggle rewinds to. */
  start0: Vector2;
  rotation: number;
  scale: Vector3;
  /** The object's scale BEFORE the drag started — never re-baselined. Uniform (Shift) scaling snaps to
   *  this aspect ratio, so holding Shift after a non-uniform drag locks to the original aspect (Photoshop),
   *  not the mid-drag distorted one. */
  scale0: Vector3;
  pos: Vector3;
  /** The object's position BEFORE the drag started (pairs with scale0 for the rewind). */
  pos0: Vector3;
  /** Fixed point the scale pivots about (the opposite corner/edge, or centre with Ctrl), local + canvas. */
  anchorLocal: Vector2;
  anchorCanvas: Vector2;
  /** Both candidate anchors projected through the PRE-DRAG transform, so a mid-drag Ctrl toggle
   *  can reinterpret the whole drag from the press (retroactive), not just from the toggle. */
  anchorCanvasNormal0: Vector2;
  anchorCanvasCenter0: Vector2;
  /** Modifier state at the last reinterpretation. */
  shift: boolean;
  ctrl: boolean;
}

/** The control-point vertex multi-drag snapshot: the selected indices + their start positions. */
interface VertSnap {
  startCanvas: Vector2;
  starts: { i: number; p: Vector2 }[];
}

const PAD = 6; // local-px breathing room around the footprint

function GizmosInner(props: {
  maskFocus: { nodeId: string; maskId: string; seq: number } | null;
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
  /** The effective (rebindable) delete chord — MaskGizmo owns it while a mask anchor is selected. */
  deleteKeys: string | null;
}): React.JSX.Element | null {
  const { doc, selectedId, viewport, store, tool, selVerts, setSelVerts, setPlacing, snap, maskFocus, deleteKeys } = props;
  // grid + guide snap for any world point being edited (no-op when both toggles are off)
  const snapPt = editSnap(doc.canvas, snap, viewport.zoom);
  const selNode = selectedId ? findNode(doc.layers, selectedId) : null;
  const unlocked = !selNode?.locked;
  const handles = tool === "select" && unlocked; // object transform handles (corners/edges)
  const vertHandles = (tool === "select" || tool === "vertex") && unlocked; // vertex dots + group
  const bezierDrag = usePointerDrag<{ kind: "point" | "in" | "out"; i: number }>(); // cable pen edit
  const anchorScaleDrag = usePointerDrag<{ i: number; base: number }>(); // per-anchor cross-section taper
  const dragState = usePointerDrag<DragSnap>();
  const rotDrag = usePointerDrag<{ start: Vector2; startRotation: number; pivot: Vector2 }>();
  // multi-vertex selection lives in CanvasView; this is the move/scale drag state
  const vertDrag = usePointerDrag<VertSnap>();
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
  const object = selNode && isObject(selNode) ? selNode : undefined;
  if (!object) {
    // a group has no object body — render its transform gizmo + its mask editor (edit anchors on canvas)
    if (!selNode || !isGroup(selNode)) return null;
    return (
      <>
        <GroupGizmo group={selNode} viewport={viewport} store={store} doc={doc} />
        {unlocked && selNode.masks?.length ? (
          <MaskGizmo nodeId={selNode.id} masks={selNode.masks} doc={doc} viewport={viewport} snap={snap} store={store} focus={maskFocus?.nodeId === selNode.id ? maskFocus : null} deleteKeys={deleteKeys} />
        ) : null}
      </>
    );
  }

  // resolve the object's frames so the gizmo overlay + editing line up with the FIELD even when the
  // object is nested in groups. parentAffine = the object's parent frame (local TRS edits live in it);
  // worldAffine = full local->world. For a top-level object parentAffine is identity and worldAffine
  // equals fromLocal(object.transform), so all of this reduces to the original (unchanged) behaviour.
  const { parentAffine, invParent, worldAffine, invWorld } = nodeFrames(doc.layers, object.id);
  /** object-local point -> screen px (through every ancestor group). */
  const toScreen = (localPt: Vector2): Vector2 => canvasToScreen(viewport, affineApply(worldAffine, localPt));
  /** world/canvas point -> object-local (inverse of the full chain). */
  const w2l = (worldPt: Vector2): Vector2 => affineApply(invWorld, worldPt);

  const bounds = localBounds(object);
  const pad = PAD / Math.max(0.0001, (Math.abs(object.transform.scale.x) + Math.abs(object.transform.scale.y)) / 2);
  const cornersLocal = paddedCorners(bounds, pad);
  const corners = cornersLocal.map((c) => toScreen(c));
  // footprint corners (no pad): stable during a scale drag, used as scale anchors
  const boundsCorners = paddedCorners(bounds, 0);
  const boundsCenter = v2((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2);

  const eventCanvasPoint = (e: React.MouseEvent): Vector2 => eventToCanvas(e, viewport);
  // the transform handles edit the object's LOCAL TRS, which lives in the PARENT frame — so their drag
  // math runs in parent-local coords. (identity parent => same as the world event point.)
  const eventParent = (e: React.MouseEvent): Vector2 => affineApply(invParent, eventCanvasPoint(e));

  // The pinned point is normally the opposite corner/edge (`normalAnchor`), or the centre with Ctrl
  // (scale-from-centre). A modifier toggle mid-drag reinterprets the WHOLE drag under the new mode —
  // as if it had been held from the press — matching Shift's original-aspect (scale0) behaviour
  // instead of Ctrl only applying from the toggle onward.
  const handleProps = (normalAnchor: Vector2, apply: (p: Vector2, e: React.PointerEvent, ds: DragSnap) => void) =>
    dragState({
      onStart: (e) => {
        if (e.button !== 0) return null; // left only: middle = pan, right = context menu
        const anchorLocal = e.ctrlKey ? boundsCenter : normalAnchor;
        const start = eventParent(e);
        return {
          start,
          start0: start,
          rotation: object.transform.rotation,
          scale: object.transform.scale,
          scale0: object.transform.scale, // immutable pre-drag aspect (never re-baselined)
          pos: object.transform.pos,
          pos0: object.transform.pos,
          anchorLocal,
          anchorCanvas: localToCanvas(object, anchorLocal),
          anchorCanvasNormal0: localToCanvas(object, normalAnchor),
          anchorCanvasCenter0: localToCanvas(object, boundsCenter),
          shift: e.shiftKey,
          ctrl: e.ctrlKey,
        };
      },
      onMove: (e, ds) => {
        if (e.shiftKey !== ds.shift || e.ctrlKey !== ds.ctrl) {
          // Rewind to the pre-drag baseline and let apply() recompute the whole drag under the
          // new modifiers (retroactive; the visible jump IS the reinterpretation).
          ds.shift = e.shiftKey;
          ds.ctrl = e.ctrlKey;
          ds.start = ds.start0;
          ds.scale = ds.scale0;
          ds.pos = ds.pos0;
          ds.anchorLocal = e.ctrlKey ? boundsCenter : normalAnchor;
          ds.anchorCanvas = e.ctrlKey ? ds.anchorCanvasCenter0 : ds.anchorCanvasNormal0;
        }
        apply(eventParent(e), e, ds);
      },
      onEnd: () => store.endGesture(),
    });

  /** Apply a new scale while pinning the drag anchor (opposite corner/edge) in place. */
  const scaleAround = (sc: Vector3, ds: DragSnap): void => {
    const c = Math.cos(ds.rotation);
    const s = Math.sin(ds.rotation);
    const rx = ds.anchorLocal.x * sc.x;
    const ry = ds.anchorLocal.y * sc.y;
    // pos shifts so anchorLocal still lands on anchorCanvas under the new scale
    const pos = new Vector3(ds.anchorCanvas.x - (rx * c - ry * s), ds.anchorCanvas.y - (rx * s + ry * c), ds.pos.z);
    store.update(
      (d) => updateObject(d, object.id, (sh) => ({ ...sh, transform: { ...sh.transform, scale: sc, pos } })),
      { coalesce: `scale:${object.id}` },
    );
  };

  /** Corner drag: scales both footprint axes from the opposite corner (Shift = uniform, Ctrl = from centre). */
  const cornerScale = (i: number) =>
    handleProps(
      boundsCorners[(i + 2) % 4]!,
      // uniform (Shift) references the immutable pre-drag scale0 so it snaps to the ORIGINAL aspect
      (p, e, ds) => scaleAround(axisScaleFromDrag(ds.anchorCanvas, ds.rotation, ds.start, p, e.shiftKey ? ds.scale0 : ds.scale, e.shiftKey), ds),
    );

  /** Edge drag: scales the perpendicular axis from the opposite edge (Shift = uniform, Ctrl = from centre). */
  const edgeScale = (i: number, axis: "x" | "y") => {
    const a = boundsCorners[(i + 2) % 4]!;
    const b = boundsCorners[(i + 3) % 4]!;
    const oppositeMid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
    return handleProps(
      oppositeMid,
      (p, e, ds) => {
        const sc = axisScaleFromDrag(ds.anchorCanvas, ds.rotation, ds.start, p, e.shiftKey ? ds.scale0 : ds.scale, e.shiftKey);
        scaleAround(e.shiftKey ? sc : axis === "x" ? ds.scale.withX(sc.x) : ds.scale.withY(sc.y), ds);
      },
    );
  };

  /** Rotate handle: drag an arm extending from an edge to spin the object about its pivot (Shift = 15°). */
  const rotateHandle = () =>
    rotDrag({
      onStart: (e) => {
        if (e.button !== 0) return null; // left only: middle = pan, right = context menu
        return {
          start: eventParent(e),
          startRotation: object.transform.rotation,
          pivot: v2(object.transform.pos.x, object.transform.pos.y),
        };
      },
      onMove: (e, rd) => {
        let rot = rotationFromDrag(rd.pivot, rd.start, eventParent(e), rd.startRotation);
        if (e.shiftKey) rot = snapAngle(rot, ROTATE_SNAP);
        store.update((d) => updateObject(d, object.id, (s) => ({ ...s, transform: { ...s.transform, rotation: rot } })), {
          coalesce: `rot:${object.id}`,
        });
      },
      onEnd: () => store.endGesture(),
    });

  // commit a transform of the selected control points (move or scale), keyed by their start
  // positions captured at drag-start so repeated moves don't compound
  const applyVertDrag = (d: VertSnap, transformLocal: (start: Vector2) => Vector2): void => {
    const byIndex = new Map(d.starts.map((s) => [s.i, s.p]));
    // snap the vertex's CANVAS position (not its local coord), so it lands on the grid / guides
    // the user sees regardless of the object's scale/rotation
    const place = (local: Vector2): Vector2 => w2l(snapPt(affineApply(worldAffine, local)));
    store.update(
      (doc2) =>
        updateObject(doc2, object.id, (s) => ({
          ...s,
          controlPoints: s.controlPoints.map((cp, ci) => {
            const start = byIndex.get(ci);
            return start ? place(transformLocal(start)) : cp;
          }),
        })),
      { coalesce: `vgrp:${object.id}` },
    );
  };

  const vertSnap = (e: React.PointerEvent, indices: number[]): VertSnap => ({
    startCanvas: eventCanvasPoint(e),
    starts: indices.map((i) => ({ i, p: object.controlPoints[i]! })),
  });

  // a vertex dot: shift-click toggles it in the selection; plain drag moves the selection
  // (selecting just this one first if it wasn't already selected)
  const vertexHandle = (i: number) =>
    vertDrag({
      onStart: (e) => {
        if (e.button !== 0) return null; // right-click handled by onContextMenu
        if (e.shiftKey) {
          e.stopPropagation();
          setSelVerts((s) => toggleIndex(s, i));
          return null;
        }
        const group = grabGroup(selVerts, i);
        if (!selVerts.includes(i)) setSelVerts([i]);
        setDraggingVert(true);
        return vertSnap(e, group);
      },
      onMove: (e, d) => {
        let cdx = eventCanvasPoint(e).x - d.startCanvas.x;
        let cdy = eventCanvasPoint(e).y - d.startCanvas.y;
        // Shift mid-drag locks to the dominant canvas axis (screen H/V) — same as godot move-mode
        // (CanvasView). Constrain in CANVAS space so the lock stays screen-horizontal/vertical even on
        // a rotated object, then carry the constrained delta through w2l into local space.
        if (e.shiftKey) ({ dx: cdx, dy: cdy } = constrainAxis(cdx, cdy));
        const cur = w2l(v2(d.startCanvas.x + cdx, d.startCanvas.y + cdy));
        const s0 = w2l(d.startCanvas);
        const dl = v2(cur.x - s0.x, cur.y - s0.y);
        applyVertDrag(d, (start) => v2(start.x + dl.x, start.y + dl.y));
      },
      onEnd: () => {
        setDraggingVert(false);
        store.endGesture();
      },
      threshold: HANDLE_DRAG_PX,
    });

  // --- context-menu / edit operations ---
  // insert a vertex on edge (ia,ib) at parameter t. Mesh splits the edge (new tris); polygon/
  // polyline/ring splice a point between ia and ib (rings bump ringSplit when the edge is outer).
  const opAddVertex = (ia: number, ib: number, t: number): void => {
    const newIndex = object.mesh ? object.controlPoints.length : ia + 1;
    store.update((d) =>
      updateObject(d, object.id, (s) => {
        if (s.mesh) {
          const r = splitEdge(s.controlPoints, s.mesh, ia, ib, t);
          return { ...s, controlPoints: r.controlPoints, mesh: r.mesh };
        }
        const a = s.controlPoints[ia]!;
        const b = s.controlPoints[ib]!;
        const cps = insertVertex(s.controlPoints, ia, v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
        if (getObjectType(s.typeId).controlPoints.kind === "rings") {
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
      updateObject(d, object.id, (s) => {
        const t = s.mesh && connectVerts(s.controlPoints, s.mesh, a, b);
        return t ? { ...s, mesh: t } : s;
      }),
    );
    store.endGesture();
  };
  const opMerge = (verts: number[], keep: number): void => {
    store.update((d) =>
      updateObject(d, object.id, (s) => {
        const r = s.mesh && mergeVerts(s.controlPoints, s.mesh, verts, keep);
        return r ? { ...s, controlPoints: r.controlPoints, mesh: r.mesh } : s;
      }),
    );
    store.endGesture();
    setSelVerts([]);
  };
  const opDeleteEdge = (ia: number, ib: number): void => {
    store.update((d) => updateObject(d, object.id, (s) => (s.mesh ? { ...s, mesh: deleteEdge(s.mesh, ia, ib) } : s)));
    store.endGesture();
  };
  const opDelete = (verts: number[]): void => {
    store.update((d) => updateObject(d, object.id, (s) => removeObjectVertices(s, verts)));
    store.endGesture();
    setSelVerts([]);
  };
  const opZAlign = (target: number, plane: number[]): void => {
    store.update((d) =>
      updateObject(d, object.id, (s) => {
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
    if (object.mesh) {
      const neigh = neighborsOf(object.mesh, i);
      if (selVerts.length === 3 && !selVerts.includes(i) && selVerts.filter((v) => neigh.has(v)).length >= 2) {
        setMenu({ x: e.clientX, y: e.clientY, verts: [i], target: i, zalign: { target: i, plane: selVerts }, edge: null });
        return;
      }
    }
    const verts = grabGroup(selVerts, i);
    if (!selVerts.includes(i)) setSelVerts(verts);
    setMenu({ x: e.clientX, y: e.clientY, verts, target: i, zalign: null, edge: null });
  };
  // parameter t of the cursor projected onto edge (ia,ib), clamped to the segment
  const edgeT = (ia: number, ib: number, e: React.MouseEvent): number => {
    const p = w2l(eventCanvasPoint(e));
    const a = object.controlPoints[ia]!;
    const b = object.controlPoints[ib]!;
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
    if (object.mesh && v.length === 2) items.push({ label: "Connect Vertices", onClick: () => opConnect(v[0]!, v[1]!) });
    if (object.mesh && v.length >= 2 && m.target !== null) {
      items.push({ label: "Merge Vertices", onClick: () => opMerge(v, m.target!) });
    }
    const kind = getObjectType(object.typeId).controlPoints.kind;
    if (m.target !== null && (kind === "polygon" || kind === "polyline")) {
      // click-to-place a new vertex extending from this one (rubber-band, chains until Esc)
      items.push({ label: "New Vertex", onClick: () => setPlacing({ kind: "vertex", objectId: object.id, afterIndex: m.target! }) });
    }
    if (v.length >= 1) {
      if (items.length > 0) items.push("separator");
      items.push({ label: v.length === 1 ? "Delete Vertex" : "Delete Vertices", danger: true, hotkey: "⌫", onClick: () => opDelete(v) });
    }
    return items;
  };

  // any Bézier-bearing object edits via the pen: analytic strokes (Cable/Ridge, kind "none") and
  // baked fills (Contour, kind "polygon"). Fills bake their closed path to controlPoints on edit
  // so the polygon-fill field stays in sync; strokes are sampled analytically (no controlPoints).
  const isPath = !!object.bezier;
  const commitBezier = (next: BezierAnchor[], coalesce: string, starts?: { subpathStarts: number[] | undefined }): void => {
    store.update((d) => updateObject(d, object.id, (sh) => applyBezierEdit(sh, next, starts)), { coalesce });
  };
  // The clicked anchor decides the target state; every anchor in `targets` gets it (the menu's
  // keep-membership rule: right-clicking a member acts on the whole selection, like drags).
  const setAnchorsMode = (targets: number[], toCorner: boolean): void => {
    commitBezier(
      object.bezier!.map((a, idx) =>
        targets.includes(idx) && isCorner(a) !== toCorner
          ? { ...a, hIn: v2(0, 0), hOut: v2(0, 0), mode: toCorner ? ("manual" as const) : ("smooth" as const) }
          : a,
      ),
      `mode:${object.id}`,
    );
    store.endGesture();
  };
  const setAnchorsSym = (targets: number[], sym: boolean): void => {
    commitBezier(
      object.bezier!.map((a, idx) => (targets.includes(idx) ? { ...a, sym: sym ? undefined : false } : a)),
      `sym:${object.id}`,
    );
    store.endGesture();
  };
  const deleteAnchors = (targets: number[]): void => {
    const b = object.bezier!;
    if (b.length - targets.length < 2) return; // a cable needs >= 2 anchors
    commitBezier(
      b.filter((_, idx) => !targets.includes(idx)),
      `del:${object.id}`,
    );
    setSelVerts([]);
    store.endGesture();
  };
  // join/unjoin the ends: toggle the path between an open stroke and a closed loop (O-ring). Path-level
  // (mirrors the mesh-vertex join right-click); needs >= 3 anchors so the loop has >= 3 segments.
  const toggleClosed = (): void => {
    store.update((d) => updateObject(d, object.id, (sh) => ({ ...sh, closed: !sh.closed })), { coalesce: `close:${object.id}` });
    store.endGesture();
  };
  // add a hole to a Contour: another inner loop (subpath), CSG-subtracted from the fill. Each
  // new hole is nudged off-centre by the existing hole count so they don't stack on top of each other.
  const addHole = (): void => {
    const b = object.bezier!;
    const holeIdx = (object.subpathStarts?.length ?? 1) - 1; // existing holes
    const cx = b.reduce((s, a) => s + a.p.x, 0) / b.length + holeIdx * 10;
    const cy = b.reduce((s, a) => s + a.p.y, 0) / b.length;
    const cn = (dx: number, dy: number) => bezierAnchor(v2(cx + dx, cy + dy), v2(0, 0), v2(0, 0), "manual");
    const hole = [cn(-10, -10), cn(10, -10), cn(10, 10), cn(-10, 10)];
    store.update(
      (d) =>
        updateObject(d, object.id, (sh) => {
          const next = [...sh.bezier!, ...hole];
          const subs = [...(sh.subpathStarts ?? [0]), sh.bezier!.length];
          const r = bakeRings(next, subs);
          return { ...sh, bezier: next, subpathStarts: subs, controlPoints: r.controlPoints, ringSplit: r.ringSplit, contourCounts: r.contourCounts };
        }),
      { coalesce: `hole:${object.id}` },
    );
    store.endGesture();
  };
  const cableMenuItems = (i: number): MenuEntry[] => {
    const b = object.bezier!;
    const items: MenuEntry[] = [];
    // keep-membership rule: right-clicking a SELECTED anchor acts on the whole selection
    const targets = selVerts.includes(i) && selVerts.length > 1 ? selVerts : [i];
    const n = targets.length;
    if (!object.closed && (i === 0 || i === b.length - 1) && n === 1) {
      items.push({ label: "Extend Cable", onClick: () => setPlacing({ kind: "cable-end", objectId: object.id, end: i === 0 ? "start" : "end" }) });
    }
    // the clicked anchor decides the direction; the whole selection gets it
    const toCorner = !isCorner(b[i]!);
    items.push({
      label: n > 1 ? (toCorner ? `Make ${n} Corners` : `Make ${n} Smooth`) : toCorner ? "Make Corner" : "Make Smooth",
      onClick: () => setAnchorsMode(targets, toCorner),
    });
    if (!isCorner(b[i]!)) {
      const toSym = b[i]!.sym === false;
      items.push({
        label: `${toSym ? "Make Tangents Symmetric" : "Make Tangents Independent"}${n > 1 ? ` (${n})` : ""}`,
        onClick: () => setAnchorsSym(targets, toSym),
      });
    }
    if (b.length >= 3) {
      items.push("separator", { label: object.closed ? "Open Path" : "Close Path", onClick: toggleClosed });
    }
    if ((object.typeId === ObjectTypeId.SurfaceVector || object.typeId === ObjectTypeId.Pillow || object.typeId === ObjectTypeId.Adjust) && (object.subpathStarts?.length ?? 1) < 7) {
      items.push({ label: "Add Hole", onClick: addHole }); // up to 6 holes (the spare record slots)
    }
    if (b.length - n >= 2) {
      items.push("separator", { label: n > 1 ? `Delete ${n} Vertices` : "Delete Vertex", danger: true, hotkey: "⌫", onClick: () => deleteAnchors(targets) });
    }
    return items;
  };
  // drag handlers for a vertex point / its in / out tangent handle (mirror on plain drag, Alt breaks)
  const bezierHandleProps = (kind: "point" | "in" | "out", i: number) =>
    bezierDrag({
      onStart: (e) => {
        if (e.button !== 0) return null;
        // anchor (not tangent) drags arm the octant alignment guide on the path segments,
        // matching the control-point vertex drag
        if (kind === "point") setDraggingVert(true);
        return { kind, i };
      },
      onMove: (e, drag) => {
        if (!object.bezier) return;
        const canvasPt = eventCanvasPoint(e);
        if (drag.kind === "point") {
          // snap the anchor's CANVAS position (grid + guides), like control-point vertices
          const local = w2l(snapPt(canvasPt));
          const group = selVerts.includes(drag.i) && selVerts.length > 1 ? selVerts : null;
          if (group) {
            // multi-anchor drag: the grabbed anchor lands on the snapped target; the rest translate by
            // the same delta (handles are offsets, so they ride along)
            const cur = object.bezier[drag.i]!.p;
            const ddx = local.x - cur.x;
            const ddy = local.y - cur.y;
            commitBezier(
              object.bezier.map((a, ai) => (group.includes(ai) ? { ...a, p: v2(a.p.x + ddx, a.p.y + ddy) } : a)),
              `bez:${object.id}`,
            );
          } else {
            commitBezier(movePoint(object.bezier, drag.i, local, e.altKey), `bez:${object.id}`);
          }
          return;
        }
        // tangent drag: symmetric per the anchor's sym flag, Alt inverts it; Shift snaps the angle to 15deg.
        // Bake the dragged anchor's RESOLVED tangents first (smooth->manual) so an independent drag keeps
        // the OTHER tangent at its auto-derived value instead of the stored zero (which would vanish).
        const local = w2l(canvasPt);
        const r = resolvePath(object.bezier, object.subpathStarts, !!object.closed)[drag.i]!;
        const based = object.bezier.map((a, idx) => (idx === drag.i ? { ...a, hIn: r.hIn, hOut: r.hOut, mode: "manual" as const } : a));
        const sym = object.bezier[drag.i]!.sym !== false;
        const next = dragHandle(based, drag.i, drag.kind, local, sym !== e.altKey, e.shiftKey ? ROTATE_SNAP : undefined);
        commitBezier(next, `bez:${object.id}`);
      },
      onEnd: () => {
        setDraggingVert(false);
        store.endGesture();
      },
      threshold: HANDLE_DRAG_PX,
    });
  // Press on the curve inserts an anchor WITHOUT changing it (de Casteljau split on the resolved path;
  // the three touched anchors are pinned manual so resolveHandles won't re-smooth + undo the split), then
  // the SAME press flows straight into dragging the new anchor — one continuous click-drag-to-place. A
  // press with no movement (< threshold) degrades to a plain insert at the split point. Insert + drag
  // share one coalesce key, so the whole gesture is a single undo step.
  const insertOnCurve = bezierDrag({
    onStart: (e) => {
      if (e.button !== 0 || !object.bezier) return null;
      const near = nearestOnPath(object.bezier, object.subpathStarts, !!object.closed, w2l(eventCanvasPoint(e)));
      if (!near) return null;
      const ins = insertOnPath(object.bezier, object.subpathStarts, !!object.closed, near);
      setSelVerts([ins.index]);
      commitBezier(ins.anchors, `insdrag:${object.id}`, { subpathStarts: ins.subpathStarts });
      setDraggingVert(true); // the insert flows into an anchor drag — arm the alignment guide
      return { kind: "point", i: ins.index };
    },
    onMove: (e, drag) => {
      if (!object.bezier || drag.kind !== "point") return;
      const local = w2l(snapPt(eventCanvasPoint(e))); // snap the new anchor's canvas position (grid + guides)
      commitBezier(movePoint(object.bezier, drag.i, local, e.altKey), `insdrag:${object.id}`);
    },
    onEnd: () => {
      setDraggingVert(false);
      store.endGesture();
    },
    threshold: HANDLE_DRAG_PX,
  });
  const bezScreen = (local: Vector2): Vector2 => toScreen(local);


  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        {/* dark halo so handles survive white height maps and saturated normal maps */}
        <GizmoHalo id="gizmo-halo" />
      </defs>
      <g filter="url(#gizmo-halo)">
      {/* cable Bézier pen: clickable curve (insert), tangent stalks, vertex + handle dots */}
      {isPath && vertHandles ? (
        <>
          {/* one centreline per subpath loop (Mesa has base + top rings) */}
          {splitSubpaths(object.bezier!, object.subpathStarts).map((loop, li) => {
            const PER_SEG = 24;
            const spine = bezierSpine(loop, PER_SEG, object.closed);
            const pts = spine.map((cp) => { const s = bezScreen(cp); return `${s.x},${s.y}`; }).join(" ");
            // Visible centreline, split PER SEGMENT so the octant alignment guide can light one
            // stretch: while an anchor drags, a segment whose anchor-to-anchor CHORD sits on a
            // 0/45/90 axis (within ¼ canvas px) goes bright white + thick — the same cue the
            // control-point shapes' seg() edges give.
            const alignTol = 0.25 * viewport.zoom;
            const segs = object.closed && loop.length >= 3 ? loop.length : loop.length - 1;
            const segLines: React.JSX.Element[] = [];
            for (let i = 0; i < segs; i++) {
              const a = bezScreen(loop[i]!.p);
              const b = bezScreen(loop[(i + 1) % loop.length]!.p);
              const on = draggingVert && alignedToAxis(a, b, alignTol);
              const segPts = spine
                .slice(i * PER_SEG, i * PER_SEG + PER_SEG + 1)
                .map((cp) => { const s = bezScreen(cp); return `${s.x},${s.y}`; })
                .join(" ");
              segLines.push(
                <polyline
                  key={i}
                  points={segPts}
                  fill="none"
                  stroke={on ? "#ffffff" : "var(--color-accent)"}
                  strokeWidth={on ? 3 : 1.5}
                  strokeOpacity={on ? 1 : 0.85}
                  style={{ pointerEvents: "none" }}
                />,
              );
            }
            return (
              <g key={li}>
                {segLines}
                {/* invisible hit strip: click anywhere along the path to insert an anchor (and keep
                    dragging it). SLIM in the select tool so a body-drag of a thin Cable/Ridge still has
                    grabbable body either side of the centreline; the vertex tool gets the fat strip. */}
                <polyline
                  points={pts}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={tool === "vertex" ? 14 : 6}
                  style={{ pointerEvents: "stroke", cursor: "copy" }}
                  {...insertOnCurve}
                />
              </g>
            );
          })}
          <AnchorHandles
            resolved={resolvePath(object.bezier!, object.subpathStarts, !!object.closed)}
            toScreen={bezScreen}
            color="var(--color-accent)"
            tangentProps={bezierHandleProps}
            isCorner={(i) => isCorner(object.bezier![i]!)}
            isSelected={(i) => selVerts.includes(i)}
            anchorProps={(i) => {
              const pointProps = bezierHandleProps("point", i);
              return {
                onPointerDown: (e) => {
                  if (e.button === 0 && e.shiftKey) {
                    // Shift-toggle into a multi-selection (so the multi-anchor Delete is reachable)
                    e.stopPropagation();
                    setSelVerts((s) => toggleIndex(s, i));
                    return;
                  }
                  // keep an existing multi-selection when grabbing one of its members (the drag then
                  // moves the whole group); otherwise select just this anchor
                  if (!selVerts.includes(i)) setSelVerts([i]);
                  pointProps.onPointerDown(e);
                },
                onPointerMove: pointProps.onPointerMove,
                onPointerUp: pointProps.onPointerUp,
                onContextMenu: (e) => {
                  // right-click an anchor -> menu (Extend on ends, Make Smooth/Corner, Delete)
                  e.preventDefault();
                  e.stopPropagation();
                  setCableMenu({ x: e.clientX, y: e.clientY, i });
                },
              };
            }}
          />
          {/* per-anchor cross-section SCALE handles (stroke taper — Illustrator width-tool style): a
              diamond on each SELECTED anchor at perpendicular distance = base·scale; drag it radially
              to taper (snaps back to 1 within 5%). Strokes only — fills have no cross-section. */}
          {object.typeId === ObjectTypeId.PipeVector || object.typeId === ObjectTypeId.BermVector
            ? (() => {
                const base =
                  object.typeId === ObjectTypeId.PipeVector
                    ? Number(object.params.radius ?? 8)
                    : Number(object.params.width ?? 16);
                const resolved = resolvePath(object.bezier!, object.subpathStarts, !!object.closed);
                return selVerts
                  .filter((i) => i < resolved.length)
                  .map((i) => {
                    const a = resolved[i]!;
                    // perpendicular to the local tangent (hOut, else hIn, else +x)
                    let tan = a.hOut;
                    if (tan.x === 0 && tan.y === 0) tan = v2(-a.hIn.x, -a.hIn.y);
                    if (tan.x === 0 && tan.y === 0) tan = v2(1, 0);
                    const len = Math.hypot(tan.x, tan.y);
                    const perp = v2(-tan.y / len, tan.x / len);
                    const scale = object.bezier![i]?.scale ?? 1;
                    const hLocal = v2(a.p.x + perp.x * base * scale, a.p.y + perp.y * base * scale);
                    const hs = bezScreen(hLocal);
                    const drag = anchorScaleDrag({
                      onStart: (e) => (e.button !== 0 ? null : { i, base }),
                      onMove: (e, d) => {
                        if (!object.bezier) return;
                        const local = w2l(eventCanvasPoint(e));
                        const anchor = object.bezier[d.i]!;
                        let sc = Math.hypot(local.x - anchor.p.x, local.y - anchor.p.y) / d.base;
                        sc = Math.min(10, Math.max(0.05, sc));
                        const next = object.bezier.map((b, bi) =>
                          bi === d.i ? { ...b, scale: Math.abs(sc - 1) < 0.05 ? undefined : sc } : b,
                        );
                        commitBezier(next, `ascale:${object.id}`);
                      },
                      onEnd: () => store.endGesture(),
                      threshold: HANDLE_DRAG_PX,
                    });
                    return (
                      <rect
                        key={`ascale-${i}`}
                        x={hs.x - 4}
                        y={hs.y - 4}
                        width={8}
                        height={8}
                        transform={`rotate(45 ${hs.x} ${hs.y})`}
                        fill="var(--color-guide)"
                        stroke="var(--color-bg)"
                        strokeWidth={1}
                        style={{ cursor: "ew-resize" }}
                        {...drag}
                      />
                    );
                  });
              })()
            : null}
        </>
      ) : null}
      {/* oriented bounding box: rotates and shears with the object's transform */}
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
      {/* rotate knobs + corner scale handles (shared gizmo chrome) */}
      {handles ? <RotateKnobs corners={corners} handlers={rotateHandle} /> : null}
      {handles ? <CornerHandles corners={corners} handlers={cornerScale} /> : null}
      {vertHandles && !isPath && getObjectType(object.typeId).controlPoints.kind !== "none"
        ? (() => {
            const kind = getObjectType(object.typeId).controlPoints.kind;
            const pts = object.controlPoints.map((cp) => toScreen(cp));
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
            // Alt-click to insert a vertex inline. Lives over the visible seg() line. Mesh edges
            // show the context-menu pointer instead of copy/+ — a plain click does NOT insert
            // there, so the + cursor promised an action a click wouldn't deliver.
            const edgeCursor = kind === "mesh" ? "cursor-context-menu" : "cursor-copy";
            const edgeHit = (ia: number, ib: number, a: Vector2, b: Vector2, key: string): React.JSX.Element => (
              <line
                key={key}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={9}
                className={`pointer-events-auto ${edgeCursor}`}
                onPointerDown={insertOnEdge(ia, ib)}
                onContextMenu={openEdgeMenu(ia, ib)}
              />
            );
            const lines: React.JSX.Element[] = [];
            if (kind === "rings") {
              const split = object.ringSplit ?? (pts.length >> 1);
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
              // no crease connectors: the slope is an analytic distance ramp (no triangulation), so any
              // base/top vertex counts are valid — the two ring outlines + the rendered fill show the shape.
            } else if (kind === "polygon") {
              pts.forEach((p, i) => {
                const j = (i + 1) % pts.length;
                lines.push(seg(p, pts[j]!, `p${i}`), edgeHit(i, j, p, pts[j]!, `ph${i}`));
              });
            } else if (kind === "mesh" && object.mesh) {
              // mesh edges: the octant-lit line + a fat hit-line (right-click menu / Alt-click insert)
              for (const [ia, ib] of meshEdges(object.mesh)) {
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
      {vertHandles && !isPath &&
        object.controlPoints.map((cp, i) => {
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
      {vertHandles && object.masks?.length ? (
        <MaskGizmo nodeId={object.id} masks={object.masks} doc={doc} viewport={viewport} snap={snap} store={store} focus={maskFocus?.nodeId === object.id ? maskFocus : null} deleteKeys={deleteKeys} />
      ) : null}
    </>
  );
}

/** Memoized: CanvasView re-renders on every pointer move (the cursor readout), but the gizmo tree —
 *  the heaviest SVG subtree — only depends on doc/selection/viewport/tool, all reference-stable while
 *  the pointer just travels. The memo skips it entirely on those moves (QC-INT-9). */
export const Gizmos = memo(GizmosInner);
