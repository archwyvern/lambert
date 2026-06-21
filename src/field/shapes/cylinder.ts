import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";

/**
 * Cylinder — a capsule with flat (square) ends instead of round caps: a `length` × `2*radius`
 * footprint whose cross-section is shaped by `profile` (round = a half-tube), constant along the
 * length and cut vertically at both ends. Z peak = radius (round => true semicircle: sqrt(r^2-y^2)).
 * Pure parametric — no editable vertices.
 */
export const Cylinder = defineShapeType({
  id: "cylinder",
  name: "Cylinder",
  category: "Profiles",
  params: {
    length: { type: "px", default: 64, min: 1, float: true },
    radius: { type: "px", default: 16, min: 1, float: true },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: 16,
  controlPoints: { kind: "none", default: [] },
  // params: 13=length 14=radius 15=profile(enum idx). Cross-section profile over |y| (the radius
  // axis), held flat along the length and cut off at the ends (dx>0 => height 0, a vertical cap).
  wgsl: /* wgsl */ `
fn shape_cylinder(p: vec2f, base: u32) -> vec2f {
  let half = rec(base, 13u) * 0.5;
  let r = rec(base, 14u);
  let prof = u32(rec(base, 15u));
  let dy = abs(p.y) - r;
  let dx = abs(p.x) - half;
  let sd = max(dy, dx);
  let h = select(0.0, r * apply_profile(prof, -dy, r), dx <= 0.0);
  return vec2f(h, sd);
}
`,
  eval(p, shape) {
    const half = numParam(shape, "length") / 2;
    const r = numParam(shape, "radius");
    const prof = enumParam(shape, "profile") as ProfileKind;
    const dy = Math.abs(p.y) - r;
    const dx = Math.abs(p.x) - half;
    const sd = Math.max(dy, dx);
    const h = dx <= 0 ? r * applyProfile(prof, -dy, r) : 0;
    return { height: h, sd };
  },
});
