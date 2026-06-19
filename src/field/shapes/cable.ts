import { bezierAnchor, ctrlIn, ctrlOut, cubicDist, resolveHandles } from "../bezier";
import { applyProfile, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";
import { v2 } from "../vec";

/** Sample count for drawing the cable's centreline overlay (NOT the fold — the fold uses the
 *  smooth analytic distance `cubicDist`). */
export const CABLE_SUB = 24;

/**
 * Cable — a VECTOR, not an SDF primitive: a tube swept along a cubic-Bézier path that is rendered
 * directly from the path (the eval + GPU fold sample the cubics per-pixel; nothing is baked to a
 * polyline). The path (anchors + tangent handles) lives in ShapeInstance.bezier; controlPoints is
 * unused. profile=round = a semicircular tube, flat = a flat-topped trapezoid (slopes span `slope`).
 */
export const Cable = defineShapeType({
  id: "cable",
  name: "Cable",
  category: "Vectors",
  params: {
    thickness: { type: "px", default: 16, min: 1 },
    profile: { type: "enum", options: ["round", "flat"], default: "round" },
    slope: { type: "px", default: 6, min: 1 },
  },
  nominalHeight: 16,
  controlPoints: { kind: "none", default: [] }, // unbaked: the path is in `bezier`
  onCreate(s) {
    s.bezier = [bezierAnchor(v2(-40, 0)), bezierAnchor(v2(40, 0))];
  },
  // params: 13=thickness 14=profile(0=round,1=flat) 15=slope; anchors packed 3 vec2 each (p,hIn,hOut)
  wgsl: /* wgsl */ `
fn shape_cable(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, 11u));
  let ac = u32(rec(base, 12u));
  let halfW = rec(base, 13u) * 0.5;
  let flat = rec(base, 14u) > 0.5;
  let slopeW = select(halfW, rec(base, 15u), flat);
  let kind = select(2u, 0u, flat); // round(2) semicircle vs linear(0) ramp
  var d = 1e30;
  for (var i = 0u; i + 1u < ac; i = i + 1u) {
    let a0 = cs + i * 3u;
    let a1 = cs + (i + 1u) * 3u;
    let p0 = points[a0];
    let c0 = points[a0] + points[a0 + 2u];
    let c1 = points[a1] + points[a1 + 1u];
    let p1 = points[a1];
    // flat-cap only the cable's true ends; interior joins stay rounded so the min() blend is seamless
    d = min(d, cubic_dist(p, p0, c0, c1, p1, i == 0u, i + 2u == ac));
  }
  let sd = d - halfW;
  return vec2f(16.0 * apply_profile(kind, -sd, slopeW), sd);
}
`,
  eval(p, shape) {
    if (!shape.bezier || shape.bezier.length < 2) return { height: 0, sd: 1e9 };
    const b = resolveHandles(shape.bezier);
    const halfW = numParam(shape, "thickness") / 2;
    const flat = enumParam(shape, "profile") === "flat";
    const slope = flat ? numParam(shape, "slope") : halfW;
    const kind: ProfileKind = flat ? "linear" : "round";
    let d = Infinity;
    for (let i = 0; i + 1 < b.length; i++) {
      // flat-cap only the cable's true ends; interior joins stay rounded so the min() blend is seamless
      d = Math.min(d, cubicDist(p, b[i]!.p, ctrlOut(b[i]!), ctrlIn(b[i + 1]!), b[i + 1]!.p, i === 0, i + 2 === b.length));
    }
    const sd = d - halfW;
    return { height: 16 * applyProfile(kind, -sd, slope), sd };
  },
});
