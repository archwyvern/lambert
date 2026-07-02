import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, numParam, ObjectTypeId } from "../registry";
import { clamp, mix } from "../vec";

/**
 * Pipe — a straight profiled bar: a tube of `length` and `radius`, optionally tapering to `radius2` at
 * the +x end, with round or flat `cap`s, the cross-section shaped by `profile`. Cylinder = flat cap,
 * Capsule = round cap, Frustum = flat cap + radius2 ≠ radius (all palette presets of this type). The
 * Bézier twin is Cable, which generalizes the straight taper to a per-anchor width. Pure
 * parametric — no editable vertices.
 */
export const Pipe = defineObjectType({
  id: ObjectTypeId.Pipe,
  name: "Pipe",
  category: "Shapes",
  params: {
    length: { type: "px", default: 64, min: 1, float: true },
    radius: { type: "px", default: 16, min: 1, float: true },
    radius2: { type: "px", default: 16, min: 0, float: true },
    cap: { type: "enum", options: ["round", "flat"], default: "round" },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: 16,
  controlPoints: { kind: "none", default: [] },
  // params: 13=length 14=radius(-x) 15=radius2(+x; 0 tapers to a point = cone) 16=cap(0=round,1=flat) 17=profile.
  // r = radius blended along the length (t: 0 at -half..1 at +half). Flat cap = cut vertically at the
  // ends (cylinder/frustum); round cap = inflate a clamped centreline segment (capsule).
  wgsl: /* wgsl */ `
fn shape_pipe(p: vec2f, base: u32) -> vec2f {
  let half = rec(base, SLOT_PARAM0) * 0.5;
  let r1 = rec(base, SLOT_PARAM1);
  let r2 = rec(base, SLOT_PARAM2);
  let flatCap = rec(base, SLOT_PARAM3) > 0.5;
  let prof = u32(rec(base, SLOT_PARAM4));
  let t = clamp((p.x + half) / (2.0 * half), 0.0, 1.0);
  let r = mix(r1, r2, t);
  if (flatCap) {
    let dy = abs(p.y) - r;
    let dx = abs(p.x) - half;
    let sd = max(dy, dx);
    let h = select(0.0, r * apply_profile(prof, -dy, r), dx <= 0.0);
    return vec2f(h, sd);
  }
  let dx = max(abs(p.x) - half, 0.0);
  let sd = length(vec2f(dx, p.y)) - r;
  return vec2f(r * apply_profile(prof, -sd, r), sd);
}
`,
  eval(p, object) {
    const half = numParam(object, "length") / 2;
    const r1 = numParam(object, "radius");
    const r2 = numParam(object, "radius2");
    const flatCap = enumParam(object, "cap") === "flat";
    const prof = enumParam(object, "profile") as ProfileKind;
    const t = clamp((p.x + half) / (2 * half), 0, 1);
    const r = mix(r1, r2, t);
    if (flatCap) {
      const dy = Math.abs(p.y) - r;
      const dx = Math.abs(p.x) - half;
      const sd = Math.max(dy, dx);
      const h = dx <= 0 ? r * applyProfile(prof, -dy, r) : 0;
      return { height: h, sd };
    }
    const dx = Math.max(Math.abs(p.x) - half, 0);
    const sd = Math.hypot(dx, p.y) - r;
    return { height: r * applyProfile(prof, -sd, r), sd };
  },
});
