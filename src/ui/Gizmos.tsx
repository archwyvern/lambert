import { useRef } from "react";
import type { DocumentStore } from "../document/store";
import { updateShape } from "../document/docOps";
import type { FlatlandDoc } from "../document/schema";
import { numParam } from "../field/registry";
import { toLocal } from "../field/transform";
import type { ShapeInstance } from "../field/types";
import { v2, Vec2 } from "../field/vec";
import { rotationFromDrag, scaleFromDrag } from "./picking";
import { canvasToScreen, screenToCanvas, Viewport } from "./viewport";

/** Local-space half-extents of a shape's footprint, for the gizmo frame. */
function localHalfExtents(s: ShapeInstance): Vec2 {
  if (s.controlPoints.length > 0) {
    let mx = 1;
    let my = 1;
    for (const p of s.controlPoints) {
      mx = Math.max(mx, Math.abs(p.x));
      my = Math.max(my, Math.abs(p.y));
    }
    return v2(mx, my);
  }
  return v2(numParam(s, "radiusX"), numParam(s, "radiusY")); // dome is the only no-point type in v1
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

  const center = canvasToScreen(viewport, shape.transform.pos);
  const ext = localHalfExtents(shape);
  const frame =
    Math.max(ext.x * Math.abs(shape.transform.scale.x), ext.y * Math.abs(shape.transform.scale.y)) * viewport.zoom + 14;

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

  const handleProps = (apply: (p: Vec2) => void) => ({
    onPointerDown: beginHandleDrag,
    onPointerMove: (e: React.PointerEvent) => {
      if (!dragState.current) return;
      apply(eventCanvasPoint(e));
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

  const scale = handleProps((p) => {
    const ds = dragState.current!;
    const sc = scaleFromDrag(shape.transform.pos, ds.start, p, ds.scale);
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
      <rect
        x={center.x - frame}
        y={center.y - frame}
        width={frame * 2}
        height={frame * 2}
        fill="none"
        stroke="var(--color-accent)"
        strokeDasharray="4 3"
      />
      <line x1={center.x} y1={center.y - frame} x2={center.x} y2={center.y - frame - 12} stroke="var(--color-accent)" />
      <circle
        cx={center.x}
        cy={center.y - frame - 18}
        r={6}
        fill="var(--color-accent)"
        className="pointer-events-auto cursor-grab"
        {...rotate}
      />
      <rect
        x={center.x + frame - 5}
        y={center.y + frame - 5}
        width={10}
        height={10}
        fill="var(--color-accent)"
        className="pointer-events-auto cursor-nwse-resize"
        {...scale}
      />
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
