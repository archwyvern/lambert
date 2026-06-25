import { Vector2, Vector3 } from "@carapace/primitives";
import { usePointerDrag } from "./usePointerDrag";
import { CornerHandles, GizmoHalo, RotateKnobs } from "./gizmoChrome";
import type { DocumentStore } from "../document/store";
import { nodeFrames, updateNode } from "../document/layerOps";
import { affineApply, affineInvert } from "../field/affine";
import { flattenLayers } from "../field/flatten";
import type { LambertDoc } from "../document/schema";
import { fromLocal } from "../field/transform";
import type { Transform2D } from "../field/transform";
import type { GroupLayer } from "../field/types";
import { v2 } from "../field/vec";
import { axisScaleFromDrag, rotationFromDrag, ROTATE_SNAP, snapAngle } from "./picking";
import { localBounds, paddedCorners } from "./objectBounds";
import { canvasToScreen, Viewport } from "./viewport";
import { eventToCanvas } from "./canvasCoords";

const PAD = 6;

/** Bounds of a group's descendant footprints, in the group's local space. */
function groupLocalBounds(group: GroupLayer): { min: Vector2; max: Vector2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rs of flattenLayers(group.children)) {
    const fwd = affineInvert(rs.invAffine); // object-local -> group space
    const b = localBounds(rs.object);
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
  const moveDrag = usePointerDrag<{ start: Vector2; startPos: Vector3 }>();
  const rotDrag = usePointerDrag<{ start: Vector2; startRotation: number; pivot: Vector2 }>();
  const scaleDrag = usePointerDrag<{ start: Vector2; scale: Vector3; rotation: number; anchorLocal: Vector2; anchorCanvas: Vector2 }>();

  // resolve the group's frames so a NESTED group's gizmo lines up with the field. The group's TRS edits
  // live in its PARENT frame; rendering needs the full world frame. Top-level group => parent identity
  // => unchanged behaviour.
  const { invParent, worldAffine } = nodeFrames(doc.layers, group.id);

  const toCanvas = (cp: Vector2): Vector2 => fromLocal(t, cp); // group-local -> parent-local (for anchors)
  const toScreen = (cp: Vector2): Vector2 => canvasToScreen(viewport, affineApply(worldAffine, cp)); // -> screen
  // events run in the parent frame, where the group's TRS lives (identity parent => world == parent)
  const eventCanvas = (e: React.MouseEvent): Vector2 => affineApply(invParent, eventToCanvas(e, viewport));
  const commit = (transform: Transform2D, coalesce: string): void =>
    store.update((d) => ({ ...d, layers: updateNode(d.layers, group.id, (n) => ({ ...n, transform })) }), { coalesce });

  const bounds = groupLocalBounds(group);
  const dscale = (Math.abs(t.scale.x) + Math.abs(t.scale.y)) / 2 || 1;
  const pad = PAD / dscale;
  const cornersLocal = paddedCorners(bounds, pad);
  const corners = cornersLocal.map(toScreen);
  const boundsCorners = paddedCorners(bounds, 0);
  const center = v2((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2);
  const ring = corners.map((c) => `${c.x},${c.y}`).join(" ");

  const moveProps = moveDrag({
    onStart: (e) => (e.button !== 0 ? null : { start: eventCanvas(e), startPos: t.pos }),
    onMove: (e, m) => {
      const p = eventCanvas(e);
      commit({ ...t, pos: new Vector3(m.startPos.x + (p.x - m.start.x), m.startPos.y + (p.y - m.start.y), m.startPos.z) }, `gmove:${group.id}`);
    },
    onEnd: () => store.endGesture(),
  });

  const rotateProps = () =>
    rotDrag({
      onStart: (e) => ({ start: eventCanvas(e), startRotation: t.rotation, pivot: v2(t.pos.x, t.pos.y) }),
      onMove: (e, rd) => {
        let rot = rotationFromDrag(rd.pivot, rd.start, eventCanvas(e), rd.startRotation);
        if (e.shiftKey) rot = snapAngle(rot, ROTATE_SNAP);
        commit({ ...t, rotation: rot }, `grot:${group.id}`);
      },
      onEnd: () => store.endGesture(),
    });

  const cornerScale = (i: number) =>
    scaleDrag({
      onStart: (e) => {
        const anchorLocal = e.ctrlKey ? center : boundsCorners[(i + 2) % 4]!;
        return { start: eventCanvas(e), scale: t.scale, rotation: t.rotation, anchorLocal, anchorCanvas: toCanvas(anchorLocal) };
      },
      onMove: (e, sd) => {
        const sc = axisScaleFromDrag(sd.anchorCanvas, sd.rotation, sd.start, eventCanvas(e), sd.scale, e.shiftKey);
        // pin anchorLocal at anchorCanvas under the new scale
        const c = Math.cos(sd.rotation);
        const s = Math.sin(sd.rotation);
        const rx = sd.anchorLocal.x * sc.x;
        const ry = sd.anchorLocal.y * sc.y;
        const pos = new Vector3(sd.anchorCanvas.x - (rx * c - ry * s), sd.anchorCanvas.y - (rx * s + ry * c), t.pos.z);
        commit({ ...t, scale: sc, pos }, `gscale:${group.id}`);
      },
      onEnd: () => store.endGesture(),
    });

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <GizmoHalo id="ggizmo-halo" />
      </defs>
      <g filter="url(#ggizmo-halo)">
        {/* visible frame (not interactive) */}
        <polygon points={ring} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" />
        {/* fat invisible border = the move grab (drag the frame to move the group; inside passes through) */}
        <polygon points={ring} fill="none" stroke="transparent" strokeWidth={12} className="pointer-events-auto cursor-move" {...moveProps} />
        {/* rotate knobs + corner scale handles (shared gizmo chrome) */}
        <RotateKnobs corners={corners} handlers={rotateProps} />
        <CornerHandles corners={corners} handlers={cornerScale} />
      </g>
    </svg>
  );
}
