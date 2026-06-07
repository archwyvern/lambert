import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";
import { sdPolygon } from "../sdf";
import { v2 } from "../vec";

export const Plateau = defineShapeType({
  id: "plateau",
  name: "Plateau",
  params: {
    height: { type: "px", default: 24, min: -256, max: 256 },
    slopeWidth: { type: "px", default: 12, min: 0 },
    profile: { type: "enum", options: PROFILE_KINDS, default: "linear" },
  },
  controlPoints: {
    kind: "polygon",
    min: 3,
    default: [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32)],
  },
  // params: 13=height 14=slopeWidth 15=profile(enum idx)
  wgsl: /* wgsl */ `
fn shape_plateau(p: vec2f, base: u32) -> vec2f {
  let h = rec(base, 13u);
  let w = rec(base, 14u);
  let prof = u32(rec(base, 15u));
  let sd = sd_polygon(p, u32(rec(base, 11u)), u32(rec(base, 12u)));
  return vec2f(h * apply_profile(prof, -sd, w), sd);
}
`,
  eval(p, shape) {
    const h = numParam(shape, "height");
    const w = numParam(shape, "slopeWidth");
    const profile = enumParam(shape, "profile") as ProfileKind;
    const sd = sdPolygon(p, shape.controlPoints);
    return { height: h * applyProfile(profile, -sd, w), sd };
  },
});
