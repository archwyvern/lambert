import { useRef } from "react";
import type { DocumentStore } from "../document/store";
import { updateShape } from "../document/docOps";
import type { FlatlandDoc } from "../document/schema";
import { numParam } from "../field/registry";
import { toLocal } from "../field/transform";
import type { ShapeInstance } from "../field/types";
import { v2, Vec2 } from "../field/vec";
import { axisScaleFromDrag } from "./picking";
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
  const rx = numParam(s, "radiusX");
  const ry = numParam(s, "radiusY");
  return { min: v2(-rx, -ry), max: v2(rx, ry) };
}

/** Forward of toLocal: scale THEN rotate, then translate (pinned by picking.test.ts). */
function localToCanvas(s: ShapeInstance, cp: Vec2): Vec2 {
  const t = s.transform;
  const sx = cp.x * t.scale.x;
  const sy = cp.y * t.scale.y;
  return v2(
    t.pos.x + sx * Math.cos(t.rotation) - sy * Math.sin(t.rotation),
    t.pos.y + sx * Math.sin(t.rotation) + sy * Math.cos(t.rotation),
  );
}

const PAD = 6; // local-px breathing room around the footprint

export function Gizmos(props: {
  doc: FlatlandDoc;
  selectedId: string | null;
  viewport: Viewport;
  store: DocumentStore;
  /** Full handle set only in select mode; explicit godot tools show the frame alone. */
  tool: ToolMode;
}): React.JSX.Element | null {
  const { doc, selectedId, viewport, store, tool } = props;
  const handles = tool === "select" && !doc.shapes.find((s) => s.id === selectedId)?.locked;
  const dragState = useRef<{ start: Vec2; rotation: number; scale: { x: number; y: number; z: number } } | null>(
    null,
  );
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

  const eventCanvasPoint = (e: React.PointerEvent): Vec2 => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };

  const beginHandleDrag = (e: React.PointerEvent): void => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = {
      start: eventCanvasPoint(e),
      rotation: shape.transform.rotation,
      scale: { ...shape.transform.scale },
    };
  };

  const handleProps = (apply: (p: Vec2, e: React.PointerEvent) => void) => ({
    onPointerDown: beginHandleDrag,
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

  const applyScale = (sc: { x: number; y: number; z: number }): void => {
    store.update((d) => updateShape(d, shape.id, (s) => ({ ...s, transform: { ...s.transform, scale: sc } })), {
      coalesce: `scale:${shape.id}`,
    });
  };

  const scale = handleProps((p, e) => {
    const ds = dragState.current!;
    applyScale(axisScaleFromDrag(shape.transform.pos, ds.rotation, ds.start, p, ds.scale, e.shiftKey));
  });

  /** Edge drag scales only the perpendicular axis (shift still goes uniform). */
  const edgeScale = (axis: "x" | "y") =>
    handleProps((p, e) => {
      const ds = dragState.current!;
      const sc = axisScaleFromDrag(shape.transform.pos, ds.rotation, ds.start, p, ds.scale, e.shiftKey);
      applyScale(
        e.shiftKey ? sc : axis === "x" ? { ...ds.scale, x: sc.x } : { ...ds.scale, y: sc.y },
      );
    });

  const vertexHandle = (i: number) =>
    handleProps((p) => {
      const local = toLocal(shape.transform, p);
      store.update(
        (d) =>
          updateShape(d, shape.id, (s) => ({
            ...s,
            controlPoints: s.controlPoints.map((cp, ci) => (ci === i ? local : cp)),
          })),
        { coalesce: `vtx:${shape.id}:${i}` },
      );
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
                {...edgeScale(i % 2 === 0 ? "y" : "x")}
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
                {...scale}
              />
            );
          })
        : null}
      {handles && shape.controlPoints.map((cp, i) => {
        const sp = canvasToScreen(viewport, localToCanvas(shape, cp));
        return (
          <circle
            key={i}
            cx={sp.x}
            cy={sp.y}
            r={5}
            fill="#ffffff"
            stroke="var(--color-accent)"
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
