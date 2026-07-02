import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, ObjectTypeId } from "../registry";

/** Raised ring: a tube swept around a circle, the cross-section shaped by `profile` (round = a
 *  half-round tube, flat/linear = a flat-topped or triangular band). Major radius 48, minor (tube)
 *  16; tube height = 16 * scale.z. Footprint is the annulus only. */
const MAJOR = 48;
const MINOR = 16;

export const Torus = defineObjectType({
  id: ObjectTypeId.Torus,
  name: "Torus",
  category: "Shapes",
  params: {
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: MINOR,
  controlPoints: { kind: "none", default: [] },
  // params: 13 = profile (tube cross-section over the minor radius).
  wgsl: /* wgsl */ `
fn shape_torus(p: vec2f, base: u32) -> vec2f {
  let prof = u32(rec(base, SLOT_PARAM0));
  let dRing = abs(length(p) - 48.0);
  var height = 0.0;
  if (dRing < 16.0) { height = 16.0 * apply_profile(prof, 16.0 - dRing, 16.0); }
  return vec2f(height, dRing - 16.0);
}
`,
  eval(p, object) {
    const prof = enumParam(object, "profile") as ProfileKind;
    const dRing = Math.abs(Math.hypot(p.x, p.y) - MAJOR);
    const height = dRing < MINOR ? MINOR * applyProfile(prof, MINOR - dRing, MINOR) : 0;
    return { height, sd: dRing - MINOR };
  },
});
