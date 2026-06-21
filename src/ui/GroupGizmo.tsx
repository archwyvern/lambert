import { useRef } from "react";
import { Vector2, Vector3 } from "@carapace/primitives";
import type { DocumentStore } from "../document/store";
import { findParentId, nodeWorldAffine, updateNode } from "../document/layerOps";
import { affineApply, affineCompose, affineFromTRS, affineIdentity, affineInvert } from "../field/affine";
import { flattenLayers } from "../field/flatten";
import type { LambertDoc } from "../document/schema";
import { fromLocal } from "../field/transform";
import type { Transform2D } from "../field/transform";
import type { GroupLayer } from "../field/types";
import { v2 } from "../field/vec";
import { axisScaleFromDrag, rotationFromDrag, snapAngle } from "./picking";
import { localBounds } from "./shapeBounds";
import { canvasToScreen, screenToCanvas, Viewport } from "./viewport";

const ROTATE_SNAP = Math.PI / 12; // 15deg; Shift snaps
const PAD = 6;

/** Bounds of a group's descendant footprints, in the group's local space. */
function groupLocalBounds(group: GroupLayer): { min: Vector2; max: Vector2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rs of flattenLayers(group.children)) {
    const fwd = affineInvert(rs.invAffine); // shape-local -> group space
    const b = localBounds(rs.shape);
    for (const c of [v2(b.min.x, b.min.y), v2(b.max.x, b.min.y), v2(b.max.x, b.max.y), v2(b.min.x, b.max.y)]) {
      const p = affineApply(fwd, c);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { min: v2(-20, -20), max: v2(20, 20) }; // empty group: a small frame
  return { min: v2(minX, minY), max: v2(maxX, maxY) };
}

/**
 * Transform gizmo for a selected group: move (drag the frame border), rotate (corner knobs), and
 * scale (corner handles, per-axis; Shift = uniform, Ctrl = from centre). Edits the group's own
 * transform via updateNode; the resolved affine carries it to every descendant (non-uniform/shear
 * supported). Groups have no canvas body, so this is the only on-canvas transform surface for them.
 */
export function GroupGizmo(props: { group: GroupLayer; viewport: Viewport; store: DocumentStore; doc: LambertDoc }): React.JSX.Element {
  const { group, viewport, store, doc } = props;
  const t = group.transform;
  const moveDrag = useRef<{ start: Vector2; startPos: Vector3 } | null>(null);
  const rotDrag = useRef<{ start: Vector2; startRotation: number; pivot: Vector2 } | null>(null);
  const scaleDrag = useRef<{ start: Vector2; scale: Vector3; rotation: number; anchorLocal: Vector2; anchorCanvas: Vector2 } | null>(null);

  // resolve the group's frames so a NESTED group's gizmo lines up with the field. The group's TRS edits
  // live in its PARENT frame; rendering needs the full world frame. Top-level group => parent identity
  // => unchanged behaviour.
  const parentId = findParentId(doc.layers, group.id) ?? null;
  const parentAffine = parentId ? (nodeWorldAffine(doc.layers, parentId) ?? affineIdentity()) : affineIdentity();
  const invParent = affineInvert(parentAffine);
  const worldAffine = affineCompose(parentAffine, affineFromTRS(t));

  const toCanvas = (cp: Vector2): Vector2 => fromLocal(t, cp); // group-local -> parent-local (for anchors)
  const toScreen = (cp: Vector2): Vector2 => canvasToScreen(viewport, affineApply(worldAffine, cp)); // -> screen
  // events run in the parent frame, where the group's TRS lives (identity parent => world == parent)
  const eventCanvas = (e: React.MouseEvent): Vector2 => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    return affineApply(invParent, screenToCanvas(viewport, v2(e.clientX - r.left, e.clientY - r.top)));
  };
  const commit = (transform: Transform2D, coalesce: string): void =>
    store.update((d) => ({ ...d, layers: updateNode(d.layers, group.id, (n) => ({ ...n, transform })) }), { coalesce });

  const bounds = groupLocalBounds(group);
  const dscale = (Math.abs(t.scale.x) + Math.abs(t.scale.y)) / 2 || 1;
  const pad = PAD / dscale;
  const cornersLocal = [
    v2(bounds.min.x - pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.max.y + pad),
    v2(bounds.min.x - pad, bounds.max.y + pad),
  ];
  const corners = cornersLocal.map(toScreen);
  const boundsCorners = [
    v2(bounds.min.x, bounds.min.y),
    v2(bounds.max.x, bounds.min.y),
    v2(bounds.max.x, bounds.max.y),
    v2(bounds.min.x, bounds.max.y),
  ];
  const center = v2((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2);
  const ring = corners.map((c) => `${c.x},${c.y}`).join(" ");
  const cx = corners.reduce((a, k) => a + k.x, 0) / 4;
  const cy = corners.reduce((a, k) => a + k.y, 0) / 4;

  const moveProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      moveDrag.current = { start: eventCanvas(e), startPos: t.pos };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const m = moveDrag.current;
      if (!m) return;
      const p = eventCanvas(e);
      commit({ ...t, pos: new Vector3(m.startPos.x + (p.x - m.start.x), m.startPos.y + (p.y - m.start.y), m.startPos.z) }, `gmove:${group.id}`);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      moveDrag.current = null;
      store.endGesture();
    },
  };

  const rotateProps = () => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      rotDrag.current = { start: eventCanvas(e), startRotation: t.rotation, pivot: v2(t.pos.x, t.pos.y) };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const rd = rotDrag.current;
      if (!rd) return;
      let rot = rotationFromDrag(rd.pivot, rd.start, eventCanvas(e), rd.startRotation);
      if (e.shiftKey) rot = snapAngle(rot, ROTATE_SNAP);
      commit({ ...t, rotation: rot }, `grot:${group.id}`);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      rotDrag.current = null;
      store.endGesture();
    },
  });

  const cornerScale = (i: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const anchorLocal = e.ctrlKey ? center : boundsCorners[(i + 2) % 4]!;
      scaleDrag.current = { start: eventCanvas(e), scale: t.scale, rotation: t.rotation, anchorLocal, anchorCanvas: toCanvas(anchorLocal) };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const sd = scaleDrag.current;
      if (!sd) return;
      const sc = axisScaleFromDrag(sd.anchorCanvas, sd.rotation, sd.start, eventCanvas(e), sd.scale, e.shiftKey);
      // pin anchorLocal at anchorCanvas under the new scale
      const c = Math.cos(sd.rotation);
      const s = Math.sin(sd.rotation);
      const rx = sd.anchorLocal.x * sc.x;
      const ry = sd.anchorLocal.y * sc.y;
      const pos = new Vector3(sd.anchorCanvas.x - (rx * c - ry * s), sd.anchorCanvas.y - (rx * s + ry * c), t.pos.z);
      commit({ ...t, scale: sc, pos }, `gscale:${group.id}`);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      scaleDrag.current = null;
      store.endGesture();
    },
  });

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <filter id="ggizmo-halo" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#000000" floodOpacity="0.9" />
        </filter>
      </defs>
      <g filter="url(#ggizmo-halo)">
        {/* visible frame (not interactive) */}
        <polygon points={ring} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" />
        {/* fat invisible border = the move grab (drag the frame to move the group; inside passes through) */}
        <polygon points={ring} fill="none" stroke="transparent" strokeWidth={12} className="pointer-events-auto cursor-move" {...moveProps} />
        {/* rotate knobs at each edge midpoint */}
        {corners.map((c, i) => {
          const n = corners[(i + 1) % 4]!;
          const mid = v2((c.x + n.x) / 2, (c.y + n.y) / 2);
          let ox = mid.x - cx;
          let oy = mid.y - cy;
          const ol = Math.hypot(ox, oy) || 1;
          ox /= ol;
          oy /= ol;
          const knob = v2(mid.x + ox * 20, mid.y + oy * 20);
          return (
            <g key={`gr${i}`}>
              <line x1={mid.x} y1={mid.y} x2={knob.x} y2={knob.y} stroke="var(--color-accent)" strokeWidth={1} strokeOpacity={0.6} />
              <circle cx={knob.x} cy={knob.y} r={10} fill="transparent" className="pointer-events-auto cursor-rotate" {...rotateProps()} />
              <circle cx={knob.x} cy={knob.y} r={4} fill="#191a1b" stroke="var(--color-accent)" strokeWidth={1.5} className="pointer-events-none" />
            </g>
          );
        })}
        {/* corner scale handles (per-axis; Shift uniform, Ctrl from centre) */}
        {corners.map((c, i) => (
          <rect
            key={`gc${i}`}
            x={c.x - 5}
            y={c.y - 5}
            width={10}
            height={10}
            fill="var(--color-accent)"
            className="pointer-events-auto cursor-nwse-resize"
            {...cornerScale(i)}
          />
        ))}
      </g>
    </svg>
  );
}
