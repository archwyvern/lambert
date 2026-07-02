import { Vector2 } from "@carapace/primitives";
import { bakeRings, bezierAnchor } from "../bezier";
import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, numParam, ObjectTypeId } from "../registry";
import { sdPolygon } from "../sdf";
import type { FieldSample, ObjectInstance } from "../types";
import { v2 } from "../vec";

/** Default inflation radius: the height a pillow reaches once its soft interior distance saturates
 *  the `inflate` range (sphere-consistent: amplitude = range, so `round` gives a quarter-round rim
 *  of that radius). Tallness rides transform.scale.z. */
const PILLOW_H = 24;
/** Quarter-px² epsilon keeping the boundary integral finite ON a sample point (h -> 0 there anyway). */
const EPS2 = 0.25;

/**
 * Soft interior distance via a boundary integral: D(p) = (∮ ds / d(s)⁴)^(-1/3), the integral taken
 * over EVERY contour (outer ring + holes) in closed form per segment (segmentInv4 below).
 *
 * Why this and not the distance transform: min-distance has a gradient crease along the medial axis
 * (the ugly 45° "bevel" this type exists to beat). The integral has no min() anywhere — it is smooth
 * (C∞) across the whole interior BY CONSTRUCTION, while keeping the properties that matter:
 * ~0.86·d near a straight edge (proportional to depth), ~0.54·r at a disk's centre (thickest =
 * tallest), and holes/necks lower it automatically because they add nearby boundary.
 */
/** Exact ∫ ds/d(s)⁴ along one segment a->b: with u = arclength − projection and h = the (eps-guarded)
 *  perpendicular distance, ∫ du/(u²+h²)² = u/(2h²(u²+h²)) + atan(u/h)/(2h³) — evaluated at both ends.
 *  Closed form, so the field is EXACT regardless of how sparsely the outline baked (a corner-anchor
 *  rectangle bakes to 4 points; midpoint sampling turned each edge into a visible "point charge"). */
function segmentInv4(px: number, py: number, a: Vector2, b: Vector2): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.sqrt(ex * ex + ey * ey);
  if (len < 1e-6) return 0;
  const wx = px - a.x;
  const wy = py - a.y;
  const proj = (wx * ex + wy * ey) / len; // arclength of the closest point on the segment's LINE
  const h2 = Math.max(wx * wx + wy * wy - proj * proj, 0) + EPS2;
  const h = Math.sqrt(h2);
  const F = (u: number): number => u / (2 * h2 * (u * u + h2)) + Math.atan(u / h) / (2 * h2 * h);
  return F(len - proj) - F(-proj);
}

function softInteriorDistance(p: Vector2, cps: Vector2[], ringCounts: number[]): number {
  let inv = 0;
  let off = 0;
  for (const rc of ringCounts) {
    if (rc >= 3) {
      for (let j = 0; j < rc; j++) {
        inv += segmentInv4(p.x, p.y, cps[off + j]!, cps[off + ((j + 1) % rc)]!);
      }
    }
    off += rc;
  }
  return Math.pow(inv, -1 / 3);
}

/** CPU eval — mirrored exactly by shape_pillow in the WGSL below (drift-tested by the selftest). */
export function pillowEval(p: Vector2, object: ObjectInstance): FieldSample {
  const cps = object.controlPoints;
  const counts = object.contourCounts;
  const nB = counts?.[0] ?? object.ringSplit ?? cps.length;
  const outer = nB < cps.length ? cps.slice(0, nB) : cps;
  let sd = sdPolygon(p, outer);
  const rings: number[] = [outer.length];
  if (counts && counts.length > 1) {
    let off = counts[0]!;
    for (let h = 1; h < counts.length && h <= 6; h++) {
      const hc = counts[h]!;
      if (hc >= 3) sd = Math.max(sd, -sdPolygon(p, cps.slice(off, off + hc))); // punch each hole out
      rings.push(hc);
      off += hc;
    }
  }
  if (sd >= 0) return { height: 0, sd };
  const D = softInteriorDistance(p, cps, rings);
  const inflate = numParam(object, "inflate");
  return { height: inflate * applyProfile(enumParam(object, "profile") as ProfileKind, D, inflate), sd };
}

/**
 * Pillow — a closed drawn outline INFLATED like a balloon: the height derives from a smoothed
 * interior distance field, so the fattest part of the shape is the tallest, thin necks stay low, and
 * there is no medial-axis crease. NO params by design: the relief is defined purely by the outline
 * (move the anchors) + transform.scale. A circle inflates to a dome, a capsule outline to a 3D
 * capsule, an arbitrary blob to a cushion. Supports holes like Contour (the rim around a hole
 * deflates to 0). A Sphere converts to this as its Path form.
 */
export const Pillow = defineObjectType({
  id: ObjectTypeId.Pillow,
  name: "Pillow",
  category: "Paths",
  params: {
    inflate: { type: "px", default: PILLOW_H, min: 1, float: true },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: PILLOW_H,
  controlPoints: { kind: "rings", min: 3, default: [] }, // baked from the Bézier loop(s) in `bezier`
  onCreate(o) {
    // a circle by default: 4 smooth anchors — Catmull-Rom rounds them into a near-circle blob
    const r = 40;
    o.bezier = [bezierAnchor(v2(-r, 0)), bezierAnchor(v2(0, -r)), bezierAnchor(v2(r, 0)), bezierAnchor(v2(0, r))];
    o.closed = true;
    const b = bakeRings(o.bezier, o.subpathStarts);
    o.controlPoints = b.controlPoints;
    o.ringSplit = b.ringSplit;
    o.contourCounts = b.contourCounts;
  },
  // params: 13 = inflate, 14 = profile index; hole contour counts pack right after at SLOT_PARAM2..
  // pillow_seg_inv/pillow_ring_inv accumulate the exact boundary integral; math in pillowEval.
  wgsl: /* wgsl */ `
// exact per-segment ∫ ds/d⁴ (mirrors segmentInv4 in pillow.ts — see the derivation there)
fn pillow_seg_inv(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let e = b - a;
  let len = length(e);
  if (len < 1e-6) { return 0.0; }
  let w = p - a;
  let proj = dot(w, e) / len;
  let h2 = max(dot(w, w) - proj * proj, 0.0) + 0.25;
  let h = sqrt(h2);
  let u1 = len - proj;
  let u0 = -proj;
  let f1 = u1 / (2.0 * h2 * (u1 * u1 + h2)) + atan(u1 / h) / (2.0 * h2 * h);
  let f0 = u0 / (2.0 * h2 * (u0 * u0 + h2)) + atan(u0 / h) / (2.0 * h2 * h);
  return f1 - f0;
}

fn pillow_ring_inv(p: vec2f, start: u32, count: u32) -> f32 {
  var inv = 0.0;
  for (var j = 0u; j < count; j = j + 1u) {
    let a = points[start + j];
    let b = points[start + select(j + 1u, 0u, j + 1u >= count)];
    inv = inv + pillow_seg_inv(p, a, b);
  }
  return inv;
}

fn shape_pillow(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, SLOT_CP_START));
  let nB = u32(rec(base, SLOT_RING));
  var sd = sd_polygon(p, cs, nB);
  var off = cs + nB;
  for (var hi = 0u; hi < 6u; hi = hi + 1u) {
    let hc = u32(rec(base, SLOT_PARAM2 + hi));
    if (hc >= 3u) { sd = max(sd, -sd_polygon(p, off, hc)); }
    off = off + hc;
  }
  if (sd >= 0.0) { return vec2f(0.0, sd); }
  var inv = pillow_ring_inv(p, cs, nB);
  off = cs + nB;
  for (var hi = 0u; hi < 6u; hi = hi + 1u) {
    let hc = u32(rec(base, SLOT_PARAM2 + hi));
    if (hc >= 3u) { inv = inv + pillow_ring_inv(p, off, hc); }
    off = off + hc;
  }
  let D = pow(inv, -0.33333333);
  let inflate = rec(base, SLOT_PARAM0);
  return vec2f(inflate * apply_profile(u32(rec(base, SLOT_PARAM1)), D, inflate), sd);
}
`,
  eval: pillowEval,
});
