import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";

/**
 * Capsule — a rounded bar: a horizontal centreline segment of `length` inflated by `radius`, the
 * cross-section shaped by `profile` (round = a bullnose tube). Pure parametric — no editable
 * vertices; length/radius come from the inspector. The footprint extent is length/2 + radius, so the
 * transform bounding box actually encloses it (and corner-scaling pins the right corner).
 */
export const Capsule = defineShapeType({
  id: "capsule",
  name: "Capsule",
  category: "Profiles",
  params: {
    length: { type: "px", default: 64, min: 1, float: true },
    radius: { type: "px", default: 16, min: 1, float: true },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: 16,
  controlPoints: { kind: "none", default: [] },
  // params: 13=length 14=radius 15=profile(enum idx). Z peak = radius (round profile => a true
  // semicircular cross-section: r*sqrt(1-(d/r)^2) = sqrt(r^2-d^2)); tallness = radius * scale.z
  wgsl: /* wgsl */ `
fn shape_capsule(p: vec2f, base: u32) -> vec2f {
  let half = rec(base, 13u) * 0.5;
  let r = rec(base, 14u);
  let prof = u32(rec(base, 15u));
  let dx = max(abs(p.x) - half, 0.0);
  let sd = length(vec2f(dx, p.y)) - r;
  return vec2f(r * apply_profile(prof, -sd, r), sd);
}
`,
  eval(p, shape) {
    const half = numParam(shape, "length") / 2;
    const r = numParam(shape, "radius");
    const prof = enumParam(shape, "profile") as ProfileKind;
    const dx = Math.max(Math.abs(p.x) - half, 0);
    const sd = Math.hypot(dx, p.y) - r;
    return { height: r * applyProfile(prof, -sd, r), sd };
  },
});
