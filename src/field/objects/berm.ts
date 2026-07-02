import { applyProfile } from "../profiles";
import { defineObjectType, enumParam, numParam, ObjectTypeId } from "../registry";

/**
 * Berm — a straight flat-topped embankment (a levee; the trapezoid sibling of the Pipe bar). A bar of
 * `length` whose cross-section is a flat top spanning (width − slope) either side of the centreline,
 * with linear sloped sides over `slope`, rising to `height`. `cap` flat-cuts the ends (round rounds
 * them off). The Bézier twin is Ridge. Pure parametric — no editable vertices.
 */
export const Berm = defineObjectType({
  id: ObjectTypeId.Berm,
  name: "Berm",
  category: "Shapes",
  params: {
    length: { type: "px", default: 80, min: 1, float: true },
    width: { type: "px", default: 16, min: 1, float: true },
    slope: { type: "px", default: 6, min: 0, float: true },
    height: { type: "px", default: 12, min: 0, float: true },
    cap: { type: "enum", options: ["round", "flat"], default: "flat" },
  },
  nominalHeight: 12,
  controlPoints: { kind: "none", default: [] },
  // params: 13=length 14=width 15=slope 16=height 17=cap(0=round,1=flat). Distance to the centreline
  // segment; linear sides over `slope` (apply_profile kind 1), flat top where the ramp clamps to 1.
  wgsl: /* wgsl */ `
fn shape_berm(p: vec2f, base: u32) -> vec2f {
  let half = rec(base, SLOT_PARAM0) * 0.5;
  let width = rec(base, SLOT_PARAM1);
  let slope = rec(base, SLOT_PARAM2);
  let H = rec(base, SLOT_PARAM3);
  let flatCap = rec(base, SLOT_PARAM4) > 0.5;
  if (flatCap) {
    let dy = abs(p.y) - width;
    let dx = abs(p.x) - half;
    let sd = max(dy, dx);
    let h = select(0.0, H * apply_profile(1u, -dy, slope), dx <= 0.0);
    return vec2f(h, sd);
  }
  let dx = max(abs(p.x) - half, 0.0);
  let sd = length(vec2f(dx, p.y)) - width;
  return vec2f(H * apply_profile(1u, -sd, slope), sd);
}
`,
  eval(p, object) {
    const half = numParam(object, "length") / 2;
    const width = numParam(object, "width");
    const slope = numParam(object, "slope");
    const H = numParam(object, "height");
    const flatCap = enumParam(object, "cap") === "flat";
    if (flatCap) {
      const dy = Math.abs(p.y) - width;
      const dx = Math.abs(p.x) - half;
      const sd = Math.max(dy, dx);
      const h = dx <= 0 ? H * applyProfile("linear", -dy, slope) : 0;
      return { height: h, sd };
    }
    const dx = Math.max(Math.abs(p.x) - half, 0);
    const sd = Math.hypot(dx, p.y) - width;
    return { height: H * applyProfile("linear", -sd, slope), sd };
  },
});
