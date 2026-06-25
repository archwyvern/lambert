import { bezierAnchor, ctrlIn, ctrlOut, cubicDist, resolveHandles, resolveHandlesClosed } from "../bezier";
import { applyProfile } from "../profiles";
import { defineObjectType, enumParam, numParam, ObjectTypeId } from "../registry";
import { v2 } from "../vec";

/**
 * Berm (Vector) — a flat-topped embankment swept along a Bézier path (the trapezoid sibling of Pipe
 * (Vector); the Bézier twin of the primitive Berm). Unlike Pipe, whose cross-section peaks at the
 * spine, a Berm has a FLAT TOP plus flat (linear) sloped sides: `width` is the half-width from the
 * spine to the outer edge; `slope` is the width of each sloped side band, so the flat top spans
 * (width − slope) either side of the spine; `height` is the top height. `cap` flat-cuts the open ends;
 * `invert` carves instead of raising (fold op reads invert). Analytic (per-pixel cubic distance),
 * path in ObjectInstance.bezier, controlPoints empty.
 */
export const BermVector = defineObjectType({
  id: ObjectTypeId.BermVector,
  name: "Berm (Vector)",
  category: "Vectors",
  params: {
    width: { type: "px", default: 16, min: 1, float: true },
    slope: { type: "px", default: 6, min: 0, float: true },
    height: { type: "px", default: 12, min: 0, float: true },
    cap: { type: "enum", options: ["round", "flat"], default: "round" },
    invert: { type: "enum", options: ["raise", "carve"], default: "raise" },
  },
  nominalHeight: 12,
  controlPoints: { kind: "none", default: [] }, // analytic: the path is in `bezier`
  onCreate(s) {
    s.bezier = [bezierAnchor(v2(-40, 0)), bezierAnchor(v2(40, 0))];
  },
  // params: 13=width 14=slope 15=height 16=cap(0=round,1=flat) 17=invert(op, read in pack). slot 26 =
  // closed (loop last->first). Sides are linear (apply_profile kind 1); flat top where the ramp clamps to 1.
  wgsl: /* wgsl */ `
fn shape_berm_vector_(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, 11u));
  let ac = u32(rec(base, 12u));
  let width = rec(base, 13u);
  let slope = rec(base, 14u);
  let H = rec(base, 15u);
  let flatCap = rec(base, 16u) > 0.5;
  let closed = rec(base, 26u) > 0.5 && ac >= 3u;
  let segs = select(ac - 1u, ac, closed);
  var d = 1e30;
  for (var i = 0u; i < segs; i = i + 1u) {
    let i1 = select(i + 1u, 0u, i + 1u >= ac);
    let a0 = cs + i * 4u;
    let a1 = cs + i1 * 4u;
    let p0 = points[a0];
    let c0 = points[a0] + points[a0 + 2u];
    let c1 = points[a1] + points[a1 + 1u];
    let p1 = points[a1];
    let cutS = flatCap && !closed && i == 0u;
    let cutE = flatCap && !closed && i + 2u == ac;
    d = min(d, cubic_dist(p, p0, c0, c1, p1, cutS, cutE));
  }
  let sd = d - width;
  return vec2f(H * apply_profile(1u, -sd, slope), sd); // linear sides, flat top where it clamps to 1
}
`,
  eval(p, object) {
    if (!object.bezier || object.bezier.length < 2) return { height: 0, sd: 1e9 };
    const closed = !!object.closed && object.bezier.length >= 3;
    const b = closed ? resolveHandlesClosed(object.bezier) : resolveHandles(object.bezier);
    const width = numParam(object, "width");
    const slope = numParam(object, "slope");
    const H = numParam(object, "height");
    const flatCap = enumParam(object, "cap") === "flat";
    const segs = closed ? b.length : b.length - 1;
    let d = Infinity;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % b.length;
      const cutS = flatCap && !closed && i === 0;
      const cutE = flatCap && !closed && i + 2 === b.length;
      d = Math.min(d, cubicDist(p, b[i]!.p, ctrlOut(b[i]!), ctrlIn(b[i1]!), b[i1]!.p, cutS, cutE));
    }
    const sd = d - width;
    return { height: H * applyProfile("linear", -sd, slope), sd };
  },
});
