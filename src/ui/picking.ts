import { getShapeType } from "../field/registry";
import { distanceScale, toLocal } from "../field/transform";
import type { ShapeInstance } from "../field/types";
import type { Vec2 } from "../field/vec";

const PICK_SLOP_PX = 1;

/** Topmost visible, unlocked shape whose footprint (± slop, canvas px) contains the point. */
export function pickShape(shapes: ShapeInstance[], canvasPoint: Vec2): ShapeInstance | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (!s.visible || s.locked) continue;
    const sample = getShapeType(s.typeId).eval(toLocal(s.transform, canvasPoint), s);
    if (sample.sd * distanceScale(s.transform) <= PICK_SLOP_PX) return s;
  }
  return null;
}

/** New rotation given a drag from startPoint to currentPoint around pivot. */
export function rotationFromDrag(pivot: Vec2, startPoint: Vec2, currentPoint: Vec2, startRotation: number): number {
  const a0 = Math.atan2(startPoint.y - pivot.y, startPoint.x - pivot.x);
  const a1 = Math.atan2(currentPoint.y - pivot.y, currentPoint.x - pivot.x);
  return startRotation + (a1 - a0);
}

/** Snap an angle to step increments (godot snap_angle, absolute flavor). */
export function snapAngle(rad: number, stepRad: number): number {
  return Math.round(rad / stepRad) * stepRad;
}

/** Godot move-mode axis constraint: lock the drag delta to its dominant axis. */
export function constrainAxis(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

const clampMag = (v: number): number => Math.sign(v || 1) * Math.max(0.05, Math.abs(v));

/**
 * Photoshop-like corner scaling around the shape's pivot. Unlocked (default): each local
 * footprint axis scales by the drag ratio along that axis — dragging across the pivot
 * mirrors; z (tallness) is untouched. uniform (shift held): the pivot-distance ratio
 * applies to all three axes, so a shape grown 2x also gets 2x taller.
 */
export function axisScaleFromDrag(
  pivot: Vec2,
  rotation: number,
  startPoint: Vec2,
  currentPoint: Vec2,
  startScale: { x: number; y: number; z: number },
  uniform: boolean,
): { x: number; y: number; z: number } {
  if (uniform) {
    const d0 = Math.hypot(startPoint.x - pivot.x, startPoint.y - pivot.y) || 1;
    const d1 = Math.hypot(currentPoint.x - pivot.x, currentPoint.y - pivot.y);
    const ratio = d1 / d0;
    return {
      x: clampMag(startScale.x * ratio),
      y: clampMag(startScale.y * ratio),
      z: clampMag(startScale.z * ratio),
    };
  }
  // un-rotate into the shape's local axes (scale still applied — ratios cancel it out)
  const c = Math.cos(-rotation);
  const s = Math.sin(-rotation);
  const unrot = (p: Vec2): Vec2 => ({
    x: (p.x - pivot.x) * c - (p.y - pivot.y) * s,
    y: (p.x - pivot.x) * s + (p.y - pivot.y) * c,
  });
  const a = unrot(startPoint);
  const b = unrot(currentPoint);
  const apply = (v: number, num: number, den: number): number =>
    Math.abs(den) < 1e-3 ? v : clampMag(v * (num / den));
  return { x: apply(startScale.x, b.x, a.x), y: apply(startScale.y, b.y, a.y), z: startScale.z };
}
