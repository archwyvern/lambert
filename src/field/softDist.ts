import type { Vector2 } from "@carapace/primitives";

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

/**
 * The SHARP soft distance: D(p) = (∮ ds / d(s)⁸)^(-1/7) — the d⁴ integral's higher-exponent
 * sibling. Same properties (C∞ everywhere, exact per-segment closed form, invariant to how the
 * outline baked), but the d⁸ kernel localizes it much harder around the nearest boundary run:
 * near a straight edge it tracks ~c·d with far shorter tails, so a ratio of two of these stays
 * LINEAR across a band and only fillets tightly at corners. Mesa's slope band uses this; Pillow
 * keeps the d⁴ form (its interior inflation WANTS the broad blend). ∫ du/(u²+h²)⁴ comes from the
 * standard reduction J_n = u/(2h²(n-1)(u²+h²)^(n-1)) + (2n-3)/(2h²(n-1))·J_(n-1) down to atan.
 * WGSL mirrors: soft_seg_inv8 / soft_ring_dist8.
 */
// (1+x)^-4 binomial coefficients for the far-span series below.
const INV8_COEF = [1, -4, 10, -20, 35, -56, 84];

export function segmentInv8(px: number, py: number, a: Vector2, b: Vector2): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.sqrt(ex * ex + ey * ey);
  if (len < 1e-6) return 0;
  const wx = px - a.x;
  const wy = py - a.y;
  const proj = (wx * ex + wy * ey) / len;
  const h2 = Math.max(wx * wx + wy * wy - proj * proj, 0) + SOFT_EPS2;
  const h = Math.sqrt(h2);
  const u0 = -proj;
  const u1 = len - proj;
  // FAR SPAN (both endpoints one side, |u| >= 3h): the antiderivative difference below is a
  // catastrophic near-asymptote cancellation (each F rides ~1/h^7; the true integral is orders
  // smaller — in f32 the sum came out sign-random and pow() NaN'd). Integrate u^-8 (1+h2/u^2)^-4
  // termwise instead: every term is small by construction, truncation ~1e-4 of an already
  // negligible contribution. Mirrored exactly in WGSL soft_seg_inv8.
  if (u0 * u1 > 0 && Math.min(Math.abs(u0), Math.abs(u1)) >= 3 * h) {
    const aa = Math.min(Math.abs(u0), Math.abs(u1));
    const bb = Math.max(Math.abs(u0), Math.abs(u1));
    const ia = 1 / aa;
    const ib = 1 / bb;
    const ia2 = ia * ia;
    const ib2 = ib * ib;
    let pa = ia2 * ia2 * ia2 * ia;
    let pb = ib2 * ib2 * ib2 * ib;
    let hk = 1;
    let sum = 0;
    for (let k = 0; k < INV8_COEF.length; k++) {
      sum += (INV8_COEF[k]! * hk * (pa - pb)) / (7 + 2 * k);
      pa *= ia2;
      pb *= ib2;
      hk *= h2;
    }
    return sum;
  }
  // NEAR/SPANNING: the standard reduction J_n = u/(2h^2(n-1)s^(n-1)) + (2n-3)/(2h^2(n-1)) J_(n-1);
  // with the peak inside (or within ~3h) the difference is a healthy fraction of the magnitude,
  // so amplification stays ~25 ulp worst-case at the series boundary.
  const F = (u: number): number => {
    const s1 = u * u + h2;
    const j1 = Math.atan(u / h) / h;
    const j2 = u / (2 * h2 * s1) + j1 / (2 * h2);
    const j3 = u / (4 * h2 * s1 * s1) + (3 * j2) / (4 * h2);
    return u / (6 * h2 * s1 * s1 * s1) + (5 * j3) / (6 * h2);
  };
  return F(u1) - F(u0);
}

/** The sharp C∞ soft distance to one ring (the ∮ ds/d⁸ form above). */
export function softRingDistance8(p: Vector2, cps: Vector2[], start: number, count: number): number {
  let inv = 0;
  for (let j = 0; j < count; j++) {
    inv += segmentInv8(p.x, p.y, cps[start + j]!, cps[start + ((j + 1) % count)]!);
  }
  return Math.pow(inv, -1 / 7);
}
