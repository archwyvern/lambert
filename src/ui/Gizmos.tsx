import { useRef } from "react";
import type { DocumentStore } from "../document/store";
import { updateShape } from "../document/docOps";
import type { FlatlandDoc } from "../document/schema";
import { numParam } from "../field/registry";
import { toLocal } from "../field/transform";
import type { ShapeInstance } from "../field/types";
import { v2, Vec2 } from "../field/vec";
import { axisScaleFromDrag, rotationFromDrag } from "./picking";
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
const ROTATE_OFFSET = 16; // screen-px outward from each corner to the rotate dot

export function Gizmos(props: {
  doc: FlatlandDoc;
  selectedId: string | null;
  viewport: Viewport;
  store: DocumentStore;
}): React.JSX.Element | null {
  const { doc, selectedId, viewport, store } = props;
  const dragState = useRef<{ start: Vec2; rotation: number; scale: { x: number; y: number } } | null>(null);
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
  const boxCenter = v2(
    corners.reduce((a, c) => a + c.x, 0) / 4,
    corners.reduce((a, c) => a + c.y, 0) / 4,
  );

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

  const rotate = handleProps((p) => {
    const ds = dragState.current!;
    const rot = rotationFromDrag(shape.transform.pos, ds.start, p, ds.rotation);
    store.update((d) => updateShape(d, shape.id, (s) => ({ ...s, transform: { ...s.transform, rotation: rot } })), {
      coalesce: `rot:${shape.id}`,
    });
  });

  const scale = handleProps((p, e) => {
    const ds = dragState.current!;
    const sc = axisScaleFromDrag(shape.transform.pos, ds.rotation, ds.start, p, ds.scale, e.shiftKey);
    store.update((d) => updateShape(d, shape.id, (s) => ({ ...s, transform: { ...s.transform, scale: sc } })), {
      coalesce: `scale:${shape.id}`,
    });
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
      {/* oriented bounding box: rotates and shears with the shape's transform */}
      <polygon
        points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
        fill="none"
        stroke="var(--color-accent)"
        strokeDasharray="4 3"
      />
      {corners.map((c, i) => {
        const dir = v2(c.x - boxCenter.x, c.y - boxCenter.y);
        const len = Math.hypot(dir.x, dir.y) || 1;
        const out = v2(c.x + (dir.x / len) * ROTATE_OFFSET, c.y + (dir.y / len) * ROTATE_OFFSET);
        return (
          <g key={i}>
            {/* rotate: just outside the corner (photoshop-style) */}
            <circle
              cx={out.x}
              cy={out.y}
              r={6}
              fill="transparent"
              stroke="var(--color-accent)"
              className="pointer-events-auto cursor-grab"
              {...rotate}
            />
            {/* scale: on the corner; per-axis, shift locks uniform */}
            <rect
              x={c.x - 5}
              y={c.y - 5}
              width={10}
              height={10}
              fill="var(--color-accent)"
              className="pointer-events-auto cursor-nwse-resize"
              {...scale}
            />
          </g>
        );
      })}
      {shape.controlPoints.map((cp, i) => {
        const sp = canvasToScreen(viewport, localToCanvas(shape, cp));
        return (
          <circle
            key={i}
            cx={sp.x}
            cy={sp.y}
            r={5}
            fill="#ffffff"
            stroke="var(--color-accent)"
            className="pointer-events-auto cursor-move"
            {...vertexHandle(i)}
          />
        );
      })}
    </svg>
  );
}
