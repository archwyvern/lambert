import { fromLocal, toLocal } from "./transform";
import type { ShapeInstance } from "./types";
import { Vec2, v2 } from "./vec";

/** Snap a value to the ½-pixel grid (nearest whole or half). */
export const snapHalf = (v: number): number => Math.round(v * 2) / 2;

/** Snap a point to the ½-pixel grid. */
export const snapVec = (p: Vec2): Vec2 => v2(snapHalf(p.x), snapHalf(p.y));

/**
 * True when segment a->b is aligned to one of the 8 cardinal/diagonal axes (every 45°) within
 * `tol` — measured as PERPENDICULAR distance from the nearest axis, in the same units as the
 * points. On a ½px grid pass tol = ¼px (half a grid step): a truly-aligned edge has 0 deviation
 * and fires, one a grid-step off has ½px and does not — at ANY edge length. (An angular tolerance
 * can't do this: it tightens to nothing on long edges, so a hand-aligned wall never lights.)
 */
export function alignedToAxis(a: Vec2, b: Vec2, tol: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return false;
  return Math.min(Math.abs(dy), Math.abs(dx), Math.abs(dx - dy) / Math.SQRT2, Math.abs(dx + dy) / Math.SQRT2) <= tol;
}

/**
 * Snap a shape to the ½px CANVAS grid: its position, and every vertex's *canvas* (world)
 * position — so the rasterized vertices land on the grid the user sees, independent of the
 * shape's scale/rotation. (Snapping the local coordinate instead would step the canvas
 * position by 0.5×scale, giving 1px steps on a 2× shape.) Control points are stored back in
 * local space under the snapped transform. Scale/rotation are left alone (not pixel grids).
 */
export function snapShapeToGrid(s: ShapeInstance): ShapeInstance {
  const pos = { x: snapHalf(s.transform.pos.x), y: snapHalf(s.transform.pos.y), z: snapHalf(s.transform.pos.z) };
  const snapped = { ...s.transform, pos };
  return {
    ...s,
    transform: snapped,
    controlPoints: s.controlPoints.map((cp) => toLocal(snapped, snapVec(fromLocal(s.transform, cp)))),
  };
}
