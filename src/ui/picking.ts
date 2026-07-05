import { affineApply } from "../field/affine";
import type { ResolvedObject } from "../field/flatten";
import { getObjectType } from "../field/registry";
import type { ObjectInstance } from "../field/types";
import { bakeMasks, maskCoverage } from "../field/maskOps";
import { Vector2, Vector3 } from "@carapace/primitives";
import { v2 } from "../field/vec";

const PICK_SLOP_PX = 1;
// Below this mask coverage the object contributes nothing visible at the point, so it isn't pickable
// there. Near-zero (not 0.5) so any visible sliver stays selectable; only fully-cut regions are skipped.
const MASK_PICK_EPS = 1e-3;

/** Topmost (last-in-fold) resolved object whose world footprint (± slop, canvas px) contains the
 *  point AND isn't masked away there. Hidden subtrees are already dropped by flatten; locked objects
 *  are skipped UNLESS `includeLocked` (the right-click menu passes it so a locked object stays
 *  reachable — otherwise you couldn't even open its Unlock item; drag-pick keeps skipping them). */
export function pickObject(
  resolved: ResolvedObject[],
  canvasPoint: Vector2,
  includeLocked = false,
): ObjectInstance | null {
  for (let i = resolved.length - 1; i >= 0; i--) {
    const rs = resolved[i]!;
    if (rs.object.locked && !includeLocked) continue;
    const sample = getObjectType(rs.object.typeId).eval(affineApply(rs.invAffine, canvasPoint), rs.object);
    if (sample.sd * rs.scaleHint > PICK_SLOP_PX) continue; // outside the footprint
    // Mirror the fold's mask gate (evalCpu applies maskCoverage): a region a mask cuts away is invisible,
    // so clicking it must NOT select the shape underneath its own cut-out. Bake only this candidate's
    // masks for a single-point test — cheap, and only when the footprint already matched.
    if (rs.masks.length > 0) {
      const cov = maskCoverage(rs.masks, bakeMasks(rs.masks), rs.invAffine, rs.scaleHint, canvasPoint);
      if (cov <= MASK_PICK_EPS) continue;
    }
    return rs.object;
  }
  return null;
}

/** New rotation given a drag from startPoint to currentPoint around pivot. */
export function rotationFromDrag(pivot: Vector2, startPoint: Vector2, currentPoint: Vector2, startRotation: number): number {
  const a0 = Math.atan2(startPoint.y - pivot.y, startPoint.x - pivot.x);
  const a1 = Math.atan2(currentPoint.y - pivot.y, currentPoint.x - pivot.x);
  return startRotation + (a1 - a0);
}

/** 15deg — godot's default rotation snap step (held Shift while rotating a gizmo). */
export const ROTATE_SNAP = Math.PI / 12;

/** Snap an angle to step increments (godot snap_angle, absolute flavor). */
export function snapAngle(rad: number, stepRad: number): number {
  return Math.round(rad / stepRad) * stepRad;
}

/** Godot move-mode axis constraint: lock the drag delta to its dominant axis. */
export function constrainAxis(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

// scale floors at a small positive value — negative scale would mirror the footprint and
// invert normals (a footgun, not a feature); dragging across the pivot just clamps to ~0
const clampMag = (v: number): number => Math.max(0.05, Math.abs(v));

/**
 * Photoshop-like corner scaling around the object's pivot. Unlocked (default): each local
 * footprint axis scales by the drag ratio along that axis (never below ~0 — no mirroring);
 * z (tallness) is untouched. uniform (shift held): the pivot-distance ratio applies to all
 * three axes, so an object grown 2x also gets 2x taller.
 */
export function axisScaleFromDrag(
  pivot: Vector2,
  rotation: number,
  startPoint: Vector2,
  currentPoint: Vector2,
  startScale: Vector3,
  uniform: boolean,
): Vector3 {
  if (uniform) {
    const d0 = Math.hypot(startPoint.x - pivot.x, startPoint.y - pivot.y) || 1;
    const d1 = Math.hypot(currentPoint.x - pivot.x, currentPoint.y - pivot.y);
    const ratio = d1 / d0;
    return new Vector3(clampMag(startScale.x * ratio), clampMag(startScale.y * ratio), clampMag(startScale.z * ratio));
  }
  // un-rotate into the object's local axes (scale still applied — ratios cancel it out)
  const c = Math.cos(-rotation);
  const s = Math.sin(-rotation);
  const unrot = (p: Vector2): Vector2 =>
    v2((p.x - pivot.x) * c - (p.y - pivot.y) * s, (p.x - pivot.x) * s + (p.y - pivot.y) * c);
  const a = unrot(startPoint);
  const b = unrot(currentPoint);
  const apply = (v: number, num: number, den: number): number =>
    Math.abs(den) < 1e-3 ? v : clampMag(v * (num / den));
  return new Vector3(apply(startScale.x, b.x, a.x), apply(startScale.y, b.y, a.y), startScale.z);
}

// --- multi-vertex group editing (move/select a set of control points) ---

/** Shift-click selection toggle: drop i if already selected, else add it. */
export function toggleIndex(selected: number[], i: number): number[] {
  return selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i];
}

/** Plain-click grab group: the indices a drag should act on — the whole selection if i is already in
 *  it (so the drag moves all), else just [i] (which the caller also makes the new selection). Shared
 *  by control-point vertices, mask anchors, and cable anchors. */
export function grabGroup(selected: number[], i: number): number[] {
  return selected.includes(i) ? selected : [i];
}

/** Indices of canvas-space points inside the axis-aligned box between a and b (marquee). */
export function pointsInBox(canvasPts: Vector2[], a: Vector2, b: Vector2): number[] {
  const lo = v2(Math.min(a.x, b.x), Math.min(a.y, b.y));
  const hi = v2(Math.max(a.x, b.x), Math.max(a.y, b.y));
  const out: number[] = [];
  canvasPts.forEach((p, i) => {
    if (p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y) out.push(i);
  });
  return out;
}
