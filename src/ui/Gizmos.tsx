import { useRef } from "react";
import type { DocumentStore } from "../document/store";
import { updateShape } from "../document/docOps";
import type { FlatlandDoc } from "../document/schema";

import { fromLocal, toLocal } from "../field/transform";
import type { ShapeInstance } from "../field/types";
import { v2, Vec2 } from "../field/vec";
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
  doc: FlatlandDoc;
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

  const eventCanvasPoint = (e: React.PointerEvent): Vec2 => {
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
    store.update(
      (doc2) =>
        updateShape(doc2, shape.id, (s) => ({
          ...s,
          controlPoints: s.controlPoints.map((cp, ci) => {
            const start = byIndex.get(ci);
            return start ? transformLocal(start) : cp;
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
  };

  const vertEndProps = {
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      vertDrag.current = null;
      store.endGesture();
    },
  };

  // a vertex dot: shift-click toggles it in the selection; plain drag moves the selection
  // (selecting just this one first if it wasn't already selected)
  const vertexHandle = (i: number) => ({
    ...vertEndProps,
    onPointerDown: (e: React.PointerEvent) => {
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

  return (
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
            const cl = [v2(b.min.x, b.min.y), v2(b.max.x, b.min.y), v2(b.max.x, b.max.y), v2(b.min.x, b.max.y)];
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
            />
          );
        })}
      </g>
    </svg>
  );
}
