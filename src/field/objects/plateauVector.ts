import type { Vector2 } from "@carapace/primitives";
import { bakeRings, bezierAnchor } from "../bezier";
import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, ObjectTypeId } from "../registry";
import { sdPolygon } from "../sdf";
import { softRingDistance } from "../softDist";
import type { FieldSample, ObjectInstance } from "../types";
import { v2 } from "../vec";

const MESA_H = 24;

/**
 * Mesa CPU eval — mirrored exactly by shape_mesa in the WGSL below (drift-tested by the selftest).
 *
 * The slope band blends the two rings' SOFT boundary distances: t = D_out / (D_out + D_in), 0 at
 * the outer curve, 1 at the inner rim, C∞ in between — the same closed-form integral as Pillow
 * (field/softDist.ts). This replaced the paired trapezoid LOFT, whose per-segment facets banded
 * visibly next to Pillow's smooth rim and forced the two rings to bake to EQUAL dense counts
 * (bakeRingsUniform). With the integral the rings are independent, so Mesa uses the optimized bake
 * and any base/top anchor counts.
 */
export function mesaEval(p: Vector2, object: ObjectInstance): FieldSample {
  const profile = enumParam(object, "profile") as ProfileKind;
  const cps = object.controlPoints;
  const nB = object.ringSplit ?? (cps.length >> 1);
  const sdB = sdPolygon(p, cps.slice(0, nB));
  if (sdB >= 0) return { height: 0, sd: sdB };
  const sdT = sdPolygon(p, cps.slice(nB));
  let t = 1; // flat top inside the inner rim (its sd decides)
  if (sdT > 0) {
    const dOut = softRingDistance(p, cps, 0, nB);
    const dIn = softRingDistance(p, cps, nB, cps.length - nB);
    t = dOut / (dOut + dIn);
  }
  return { height: MESA_H * applyProfile(profile, t, 1), sd: sdB };
}

/**
 * Mesa — the Bézier twin of the primitive Plateau: a base ring and a top rim, both CLOSED
 * Bézier loops (subpaths) baked into two controlPoint rings (base + top split at ringSplit).
 * The slope between them is the soft-distance blend above — no loft seams, no ring-pairing
 * constraint. `bezier` holds both loops concatenated; `subpathStarts` marks the boundary; Gizmos
 * rebakes the rings on every edit. Drawable directly and produced by converting a Plateau.
 */
export const PlateauVector = defineObjectType({
  id: ObjectTypeId.PlateauVector,
  name: "Mesa",
  category: "Paths",
  params: {
    profile: { type: "enum", options: PROFILE_KINDS, default: "linear" },
  },
  nominalHeight: MESA_H,
  controlPoints: { kind: "rings", min: 3, default: [] }, // baked from the two Bézier loops in `bezier`
  onCreate(o) {
    // manual HARD-CORNER anchors (like Contour): the default is a crisp frustum; smooth-curve rims
    // come from toggling anchors, not from surprise Catmull-Rom rounding of the starter shape
    const corner = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
    const baseLoop = [corner(-32, -32), corner(32, -32), corner(32, 32), corner(-32, 32)];
    const topLoop = [corner(-20, -20), corner(20, -20), corner(20, 20), corner(-20, 20)];
    o.bezier = [...baseLoop, ...topLoop];
    o.subpathStarts = [0, baseLoop.length];
    o.closed = true;
    const r = bakeRings(o.bezier, o.subpathStarts);
    o.controlPoints = r.controlPoints;
    o.ringSplit = r.ringSplit;
    o.contourCounts = r.contourCounts;
  },
  // params: 13 = profile. cps: base ring (nB = rec(SLOT_RING)) then top rim.
  wgsl: /* wgsl */ `
fn shape_mesa(p: vec2f, base: u32) -> vec2f {
  let h = 24.0;
  let prof = u32(rec(base, SLOT_PARAM0));
  let cs = u32(rec(base, SLOT_CP_START));
  let nB = u32(rec(base, SLOT_RING));
  let nT = u32(rec(base, SLOT_CP_COUNT)) - nB;
  let sdB = sd_polygon(p, cs, nB);
  if (sdB >= 0.0) { return vec2f(0.0, sdB); }
  let sdT = sd_polygon(p, cs + nB, nT);
  var t = 1.0; // flat top inside the inner rim
  if (sdT > 0.0) {
    let dOut = soft_ring_dist(p, cs, nB);
    let dIn = soft_ring_dist(p, cs + nB, nT);
    t = dOut / (dOut + dIn);
  }
  return vec2f(h * apply_profile(prof, t, 1.0), sdB);
}
`,
  eval: mesaEval,
});
