import { getShapeType } from "../field/registry";
import { distanceScale, toLocal } from "../field/transform";
import type { ShapeInstance } from "../field/types";
import { Vector2, Vector3 } from "@carapace/primitives";
import { v2 } from "../field/vec";

const PICK_SLOP_PX = 1;

/** Topmost visible, unlocked shape whose footprint (± slop, canvas px) contains the point. */
export function pickShape(shapes: ShapeInstance[], canvasPoint: Vector2): ShapeInstance | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (!s.visible || s.locked) continue;
    const local = toLocal(s.transform, canvasPoint);
    const sample = getShapeType(s.typeId).eval(local, s);
    if (sample.sd * distanceScale(s.transform) <= PICK_SLOP_PX) return s;
  }
  return null;
}

/** New rotation given a drag from startPoint to currentPoint around pivot. */
export function rotationFromDrag(pivot: Vector2, startPoint: Vector2, currentPoint: Vector2, startRotation: number): number {
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

// scale floors at a small positive value — negative scale would mirror the footprint and
// invert normals (a footgun, not a feature); dragging across the pivot just clamps to ~0
const clampMag = (v: number): number => Math.max(0.05, Math.abs(v));

/**
 * Photoshop-like corner scaling around the shape's pivot. Unlocked (default): each local
 * footprint axis scales by the drag ratio along that axis (never below ~0 — no mirroring);
 * z (tallness) is untouched. uniform (shift held): the pivot-distance ratio applies to all
 * three axes, so a shape grown 2x also gets 2x taller.
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
  // un-rotate into the shape's local axes (scale still applied — ratios cancel it out)
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

// --- multi-vertex group editing (move/scale a set of selected control points) ---

/** Axis-aligned bounds + centroid of a set of points (shape-local). */
export function pointsBounds(pts: Vector2[]): { min: Vector2; max: Vector2; centroid: Vector2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    cx += p.x;
    cy += p.y;
  }
  return { min: v2(minX, minY), max: v2(maxX, maxY), centroid: v2(cx / pts.length, cy / pts.length) };
}

/** Per-axis scale factor for a group drag: how far the handle moved from the pivot. */
export function groupScaleFactor(pivot: Vector2, startLocal: Vector2, currentLocal: Vector2): Vector2 {
  const fx = Math.abs(startLocal.x - pivot.x) < 1e-3 ? 1 : (currentLocal.x - pivot.x) / (startLocal.x - pivot.x);
  const fy = Math.abs(startLocal.y - pivot.y) < 1e-3 ? 1 : (currentLocal.y - pivot.y) / (startLocal.y - pivot.y);
  return v2(fx, fy);
}

/** Scale points about a pivot by a per-axis factor (group vertex scale). */
export function scalePointsAbout(pts: Vector2[], pivot: Vector2, factor: Vector2): Vector2[] {
  return pts.map((p) => v2(pivot.x + (p.x - pivot.x) * factor.x, pivot.y + (p.y - pivot.y) * factor.y));
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
