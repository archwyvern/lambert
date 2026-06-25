import { fromLocal, toLocal } from "./transform";
import type { ObjectInstance } from "./types";
import { Vector2, Vector3 } from "@carapace/primitives";
import { v2 } from "./vec";

/** Snap a value to the ½-pixel grid (nearest whole or half). */
export const snapHalf = (v: number): number => Math.round(v * 2) / 2;

/** Snap a point to the ½-pixel grid. */
export const snapVec = (p: Vector2): Vector2 => v2(snapHalf(p.x), snapHalf(p.y));

/**
 * Snap a point to the nearest guide line on each axis independently: x to the closest vertical
 * (`v`) guide within `tolDoc`, y to the closest horizontal (`h`) guide within `tolDoc`. An axis
 * with no guide in range is left unchanged. `tolDoc` is in doc px (callers pass a screen-px
 * tolerance divided by zoom so the catch radius is constant on screen).
 */
export function snapToGuides(p: Vector2, guides: { orient: "v" | "h"; at: number }[], tolDoc: number): Vector2 {
  let x = p.x;
  let y = p.y;
  let bestX = tolDoc;
  let bestY = tolDoc;
  for (const g of guides) {
    if (g.orient === "v") {
      const d = Math.abs(p.x - g.at);
      if (d <= bestX) {
        bestX = d;
        x = g.at;
      }
    } else {
      const d = Math.abs(p.y - g.at);
      if (d <= bestY) {
        bestY = d;
        y = g.at;
      }
    }
  }
  return v2(x, y);
}

/**
 * True when segment a->b is aligned to one of the 8 cardinal/diagonal axes (every 45°) within
 * `tol` — measured as PERPENDICULAR distance from the nearest axis, in the same units as the
 * points. On a ½px grid pass tol = ¼px (half a grid step): a truly-aligned edge has 0 deviation
 * and fires, one a grid-step off has ½px and does not — at ANY edge length. (An angular tolerance
 * can't do this: it tightens to nothing on long edges, so a hand-aligned wall never lights.)
 */
export function alignedToAxis(a: Vector2, b: Vector2, tol: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return false;
  return Math.min(Math.abs(dy), Math.abs(dx), Math.abs(dx - dy) / Math.SQRT2, Math.abs(dx + dy) / Math.SQRT2) <= tol;
}

/**
 * Snap an object to the ½px CANVAS grid: its position, and every vertex's *canvas* (world)
 * position — so the rasterized vertices land on the grid the user sees, independent of the
 * object's scale/rotation. (Snapping the local coordinate instead would step the canvas
 * position by 0.5×scale, giving 1px steps on a 2× object.) Control points are stored back in
 * local space under the snapped transform. Scale/rotation are left alone (not pixel grids).
 */
export function snapObjectToGrid(s: ObjectInstance): ObjectInstance {
  const pos = new Vector3(snapHalf(s.transform.pos.x), snapHalf(s.transform.pos.y), snapHalf(s.transform.pos.z));
  const snapped = { ...s.transform, pos };
  return {
    ...s,
    transform: snapped,
    controlPoints: s.controlPoints.map((cp) => toLocal(snapped, snapVec(fromLocal(s.transform, cp)))),
  };
}
