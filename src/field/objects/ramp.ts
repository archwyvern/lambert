import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, ObjectTypeId } from "../registry";

/**
 * Ramp — a directional slope over a square footprint (half-extent 48): height rises from the −x edge
 * (0) to the +x edge (24) shaped by `profile`. linear = a straight wedge, cove = a concave fillet,
 * smooth = an eased ramp, round = a convex bullnose. Rotate to aim the slope. (Wedge/Fillet are
 * palette presets of this type.)
 */
const R = 48;
const H = 24;

export const Ramp = defineObjectType({
  id: ObjectTypeId.Ramp,
  name: "Ramp",
  category: "Shapes",
  params: {
    profile: { type: "enum", options: PROFILE_KINDS, default: "linear" },
  },
  nominalHeight: H,
  controlPoints: { kind: "none", default: [] },
  // params: 13 = profile. Square footprint; height = 24 * profile(inside = p.x + 48 over the 96 span).
  wgsl: /* wgsl */ `
fn shape_ramp(p: vec2f, base: u32) -> vec2f {
  let prof = u32(rec(base, SLOT_PARAM0));
  let sd = max(abs(p.x) - 48.0, abs(p.y) - 48.0);
  var height = 0.0;
  if (sd <= 0.0) { height = 24.0 * apply_profile(prof, p.x + 48.0, 96.0); }
  return vec2f(height, sd);
}
`,
  eval(p, object) {
    const prof = enumParam(object, "profile") as ProfileKind;
    const sd = Math.max(Math.abs(p.x) - R, Math.abs(p.y) - R);
    const height = sd <= 0 ? H * applyProfile(prof, p.x + R, 2 * R) : 0;
    return { height, sd };
  },
});
