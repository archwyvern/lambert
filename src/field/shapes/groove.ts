import { PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";
import { v2 } from "../vec";
import { spineEval } from "./spine";

export const Groove = defineShapeType({
  id: "groove",
  name: "Groove",
  category: "Profiles",
  params: {
    width: { type: "px", default: 12, min: 1 },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: 8,
  controlPoints: { kind: "polyline", min: 2, default: [v2(-32, 0), v2(32, 0)] },
  defaultCombine: "carve",
  // params: 13=width 14=profile(enum idx); cut depth = 8 * scale.z
  wgsl: /* wgsl */ `
fn shape_groove(p: vec2f, base: u32) -> vec2f {
  return shape_spine(p, base, 8.0, rec(base, 13u) * 0.5, u32(rec(base, 14u)));
}
`,
  eval(p, shape) {
    return spineEval(
      p,
      shape.controlPoints,
      numParam(shape, "width") / 2,
      8,
      enumParam(shape, "profile") as ProfileKind,
    );
  },
});
