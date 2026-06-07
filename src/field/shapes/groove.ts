import { PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";
import { v2 } from "../vec";
import { spineEval } from "./spine";

export const Groove = defineShapeType({
  id: "groove",
  name: "Groove",
  params: {
    depth: { type: "px", default: 8, min: 0, max: 256 },
    width: { type: "px", default: 12, min: 1 },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  controlPoints: { kind: "polyline", min: 2, default: [v2(-32, 0), v2(32, 0)] },
  defaultCombine: "carve",
  // params: 13=depth 14=width 15=profile(enum idx)
  wgsl: /* wgsl */ `
fn shape_groove(p: vec2f, base: u32) -> vec2f {
  return shape_spine(p, base, rec(base, 13u), rec(base, 14u) * 0.5, u32(rec(base, 15u)));
}
`,
  eval(p, shape) {
    return spineEval(
      p,
      shape.controlPoints,
      numParam(shape, "width") / 2,
      numParam(shape, "depth"),
      enumParam(shape, "profile") as ProfileKind,
    );
  },
});
