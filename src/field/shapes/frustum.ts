import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";
import { clamp, mix } from "../vec";

/**
 * Frustum — a cylinder that tapers: a horizontal bar whose radius runs linearly from `radius` at the
 * -x end to `radius2` at the +x end (a conical frustum laid on its side; radius2 < radius makes it
 * narrower at the +x end). Same model as the cylinder (flat caps, cross-section shaped by `profile`,
 * Z peak = the local radius) but with the radius interpolated along the length. Pure parametric — no
 * editable vertices.
 */
export const Frustum = defineShapeType({
  id: "frustum",
  name: "Frustum",
  category: "Profiles",
  params: {
    length: { type: "px", default: 64, min: 1, float: true },
    radius: { type: "px", default: 16, min: 1, float: true },
    radius2: { type: "px", default: 8, min: 1, float: true },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: 16,
  controlPoints: { kind: "none", default: [] },
  // params: 13=length 14=radius(-x) 15=radius2(+x) 16=profile(enum idx). The radius is mixed along the
  // length (t: 0 at -half, 1 at +half), then it's the cylinder model: cross-section profile over |y|
  // about the local radius, cut vertically at both ends (dx>0 => height 0).
  wgsl: /* wgsl */ `
fn shape_frustum(p: vec2f, base: u32) -> vec2f {
  let half = rec(base, 13u) * 0.5;
  let r1 = rec(base, 14u);
  let r2 = rec(base, 15u);
  let prof = u32(rec(base, 16u));
  let t = clamp((p.x + half) / (2.0 * half), 0.0, 1.0);
  let r = mix(r1, r2, t);
  let dy = abs(p.y) - r;
  let dx = abs(p.x) - half;
  let sd = max(dy, dx);
  let h = select(0.0, r * apply_profile(prof, -dy, r), dx <= 0.0);
  return vec2f(h, sd);
}
`,
  eval(p, shape) {
    const half = numParam(shape, "length") / 2;
    const r1 = numParam(shape, "radius");
    const r2 = numParam(shape, "radius2");
    const prof = enumParam(shape, "profile") as ProfileKind;
    const t = clamp((p.x + half) / (2 * half), 0, 1);
    const r = mix(r1, r2, t);
    const dy = Math.abs(p.y) - r;
    const dx = Math.abs(p.x) - half;
    const sd = Math.max(dy, dx);
    const h = dx <= 0 ? r * applyProfile(prof, -dy, r) : 0;
    return { height: h, sd };
  },
});
