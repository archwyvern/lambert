import type { Vector2 } from "@aphralatrax/primitives";

/** Quarter-px² epsilon keeping the boundary integral finite ON a sample point (h -> 0 there anyway). */
export const SOFT_EPS2 = 0.25;

/**
 * The soft-boundary integral primitives: D(p) = (∮ ds / d(s)⁴)^(-1/3), the integral taken in closed
 * form per segment. Why this and not the distance transform: min-distance has a gradient crease
 * along the medial axis; the integral has no min() anywhere — it is smooth (C∞) across the whole
 * interior BY CONSTRUCTION, while staying ~0.86·d near a straight edge and ~0.54·r at a disk's
 * centre. Shared by Pillow (interior inflation over all contours) and Mesa (per-ring distances
 * blending the slope band). WGSL mirrors: soft_seg_inv / soft_ring_inv / soft_ring_dist.
 */

/** Exact ∫ ds/d(s)⁴ along one segment a->b: with u = arclength − projection and h = the (eps-guarded)
 *  perpendicular distance, ∫ du/(u²+h²)² = u/(2h²(u²+h²)) + atan(u/h)/(2h³) — evaluated at both ends.
 *  Closed form, so the field is EXACT regardless of how sparsely the outline baked (a corner-anchor
 *  rectangle bakes to 4 points; midpoint sampling turned each edge into a visible "point charge"). */
export function segmentInv4(px: number, py: number, a: Vector2, b: Vector2): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.sqrt(ex * ex + ey * ey);
  if (len < 1e-6) return 0;
  const wx = px - a.x;
  const wy = py - a.y;
  const proj = (wx * ex + wy * ey) / len; // arclength of the closest point on the segment's LINE
  const h2 = Math.max(wx * wx + wy * wy - proj * proj, 0) + SOFT_EPS2;
  const h = Math.sqrt(h2);
  const F = (u: number): number => u / (2 * h2 * (u * u + h2)) + Math.atan(u / h) / (2 * h2 * h);
  return F(len - proj) - F(-proj);
}

/** ∮ over one closed ring (a contiguous run of baked points). */
export function ringInv4(p: Vector2, cps: Vector2[], start: number, count: number): number {
  let inv = 0;
  for (let j = 0; j < count; j++) {
    inv += segmentInv4(p.x, p.y, cps[start + j]!, cps[start + ((j + 1) % count)]!);
  }
  return inv;
}

/** The C∞ soft distance to one ring. */
export function softRingDistance(p: Vector2, cps: Vector2[], start: number, count: number): number {
  return Math.pow(ringInv4(p, cps, start, count), -1 / 3);
}
