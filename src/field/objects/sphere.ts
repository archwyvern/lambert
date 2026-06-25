import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, numParam, ObjectTypeId } from "../registry";

/**
 * Sphere — a radial mound of `radius` shaped by `profile` over the radius (footprint radius = peak
 * height = radius at scale 1; per-axis scale makes ellipsoids). The profile collapses several
 * primitives into one: round = a hemisphere (the namesake), linear = a cone, cove = a crater, smooth
 * = an eased dome. (Sphere/Cone/Crater are palette presets of this type.)
 */
export const Sphere = defineObjectType({
  id: ObjectTypeId.Sphere,
  name: "Sphere",
  category: "Primitives",
  params: {
    radius: { type: "px", default: 48, min: 1, float: true },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: 48,
  controlPoints: { kind: "none", default: [] },
  // params: 13 = radius, 14 = profile. height = radius * profile(inside = radius - dist).
  wgsl: /* wgsl */ `
fn shape_sphere(p: vec2f, base: u32) -> vec2f {
  let r = rec(base, 13u);
  let prof = u32(rec(base, 14u));
  let dist = length(p);
  return vec2f(r * apply_profile(prof, r - dist, r), dist - r);
}
`,
  eval(p, object) {
    const r = numParam(object, "radius");
    const prof = enumParam(object, "profile") as ProfileKind;
    const dist = Math.hypot(p.x, p.y);
    return { height: r * applyProfile(prof, r - dist, r), sd: dist - r };
  },
});
