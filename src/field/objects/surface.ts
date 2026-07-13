import { Vector2 } from "@aphralatrax/primitives";
import { defineObjectType, numParam, ObjectTypeId } from "../registry";
import { sdPolygon } from "../sdf";
import type { FieldSample, ObjectInstance } from "../types";
import { v2 } from "../vec";

/**
 * Surface — the SVG `fill` paint: a flat (optionally tilted) closed region raised into the height
 * field. `tilt` X/Y ramps the height linearly across the footprint, biased so the lowest point sits
 * on the ground and rises from there (so the slope is non-negative regardless of tilt direction);
 * tilt 0 = a flat region at the object's elevation (pos.z). The footprint is the polygon in
 * controlPoints. The Bézier twin (a curved outline) is Contour, which bakes its closed path
 * into the same controlPoints polygon and shares the eval/WGSL below.
 */

/** Polygon-fill height field: tilt ramp biased so the lowest vertex sits on the ground, polygon SDF
 *  footprint. Shared by Surface (straight) and Contour. `contourCounts` ([outer, hole1, ...],
 *  Contour) CSG-subtracts each hole ring from the outer fill (sd = max(sdOuter, -sdHole_i)). */
export function surfaceEval(p: Vector2, object: ObjectInstance): FieldSample {
  const cps = object.controlPoints;
  const counts = object.contourCounts;
  const nB = counts?.[0] ?? object.ringSplit ?? cps.length; // outer-ring count
  const outer = nB < cps.length ? cps.slice(0, nB) : cps;
  const tx = numParam(object, "tiltX");
  const ty = numParam(object, "tiltY");
  let minDot = Infinity;
  for (const v of outer) minDot = Math.min(minDot, v.x * tx + v.y * ty);
  if (!Number.isFinite(minDot)) minDot = 0;
  let sd = sdPolygon(p, outer);
  if (counts && counts.length > 1) {
    let off = counts[0]!;
    // Cap at 6 holes to match the GPU/export path (wgsl loops hi<6u; pack writes only 6 slots). The
    // add-hole UI already caps at 6, so >6 only happens via a hand-edited .lmb — this keeps CPU==GPU there.
    for (let h = 1; h < counts.length && h <= 6; h++) {
      const hc = counts[h]!;
      if (hc >= 3) sd = Math.max(sd, -sdPolygon(p, cps.slice(off, off + hc))); // punch each hole out
      off += hc;
    }
  }
  return { height: p.x * tx + p.y * ty - minDot, sd };
}

/** The shared WGSL body under `fn`. record slots: 13 = tiltX, 14 = tiltY; cpStart=11, cpCount=12.
 *  `holeAware` (Contour) reads the outer-ring count from ringSplit (slot 2) and each hole
 *  ring's baked vertex count from slots 15.. (packed right after this type's 2 params), CSG-subtracting
 *  up to 6 holes. The straight primitive ignores all that (single contour over cpCount). */
export function surfaceWgsl(fn: string, holeAware = false): string {
  const outerCount = holeAware ? "u32(rec(base, SLOT_RING))" : "cc";
  const holes = holeAware
    ? `  var off = cs + nB;
  for (var hi = 0u; hi < 6u; hi = hi + 1u) {
    let hc = u32(rec(base, SLOT_PARAM2 + hi));
    // Skip a degenerate ring (hc<3) but STILL advance off, matching the CPU (surface.ts): a valid hole
    // after a degenerate one must still punch through. Unused slots are 0 (zeroed record) -> off += 0,
    // harmless. (Old code broke the whole loop on the first <3, diverging from the CPU.)
    if (hc >= 3u) { sd = max(sd, -sd_polygon(p, off, hc)); }
    off = off + hc;
  }`
    : "";
  return /* wgsl */ `
fn ${fn}(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, SLOT_CP_START));
  let cc = u32(rec(base, SLOT_CP_COUNT));
  let nB = ${outerCount};
  let tx = rec(base, SLOT_PARAM0);
  let ty = rec(base, SLOT_PARAM1);
  var minDot = 1e30;
  for (var i = 0u; i < nB; i = i + 1u) {
    let v = points[cs + i];
    minDot = min(minDot, v.x * tx + v.y * ty);
  }
  var sd = sd_polygon(p, cs, nB);
${holes}
  let h = p.x * tx + p.y * ty - minDot; // lowest vertex at 0; elevation (pos.z) is added by the fold
  return vec2f(h, sd);
}
`;
}

export const Surface = defineObjectType({
  id: ObjectTypeId.Surface,
  name: "Plate",
  category: "Shapes",
  params: {
    tiltX: { type: "px", default: 0, min: -1, max: 1, float: true },
    tiltY: { type: "px", default: 0, min: -1, max: 1, float: true },
  },
  nominalHeight: 32, // hint only (a typical rise); the real peak is tilt-dependent
  controlPoints: {
    kind: "polygon",
    min: 3,
    default: [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32)],
  },
  wgsl: surfaceWgsl("shape_plate"),
  eval: surfaceEval,
});
