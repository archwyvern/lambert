import { PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";
import { v2 } from "../vec";
import { spineEval } from "./spine";

export const Ridge = defineShapeType({
  id: "ridge",
  name: "Ridge",
  params: {
    width: { type: "px", default: 24, min: 1 },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  nominalHeight: 16,
  controlPoints: { kind: "polyline", min: 2, default: [v2(-32, 0), v2(32, 0)] },
  // params: 13=width 14=profile(enum idx); tallness = 16 * scale.z
  wgsl: /* wgsl */ `
fn shape_ridge(p: vec2f, base: u32) -> vec2f {
  return shape_spine(p, base, 16.0, rec(base, 13u) * 0.5, u32(rec(base, 14u)));
}
`,
  eval(p, shape) {
    return spineEval(
      p,
      shape.controlPoints,
      numParam(shape, "width") / 2,
      16,
      enumParam(shape, "profile") as ProfileKind,
    );
  },
});
