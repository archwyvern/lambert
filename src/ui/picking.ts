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

/** New scale from the ratio of pivot distances; sign-preserving, magnitude-clamped. */
export function scaleFromDrag(
  pivot: Vec2,
  startPoint: Vec2,
  currentPoint: Vec2,
  startScale: { x: number; y: number },
): { x: number; y: number } {
  const d0 = Math.hypot(startPoint.x - pivot.x, startPoint.y - pivot.y) || 1;
  const d1 = Math.hypot(currentPoint.x - pivot.x, currentPoint.y - pivot.y);
  const ratio = d1 / d0;
  const apply = (v: number): number => {
    const next = v * ratio;
    return Math.sign(next || 1) * Math.max(0.05, Math.abs(next));
  };
  return { x: apply(startScale.x), y: apply(startScale.y) };
}
