import { bezierAnchor, ctrlIn, ctrlOut, cubicNearest, resolveHandles, resolveHandlesClosed } from "../bezier";
import { applyProfile } from "../profiles";
import { defineObjectType, enumParam, numParam, ObjectTypeId } from "../registry";
import { v2 } from "../vec";

/**
 * Ridge — a flat-topped embankment swept along a Bézier path (the trapezoid sibling of Pipe
 * (Vector); the Bézier twin of the primitive Berm). Unlike Pipe, whose cross-section peaks at the
 * spine, a Berm has a FLAT TOP plus flat (linear) sloped sides: `width` is the half-width from the
 * spine to the outer edge; `slope` is the width of each sloped side band, so the flat top spans
 * (width − slope) either side of the spine; `height` is the top height. `cap` flat-cuts the open ends;
 * `invert` carves instead of raising (fold op reads invert). Analytic (per-pixel cubic distance),
 * path in ObjectInstance.bezier, controlPoints empty.
 */
export const BermVector = defineObjectType({
  id: ObjectTypeId.BermVector,
  name: "Ridge",
  category: "Paths",
  params: {
    width: { type: "px", default: 16, min: 1, float: true },
    slope: { type: "px", default: 6, min: 0, float: true },
    height: { type: "px", default: 12, min: 0, float: true },
    cap: { type: "enum", options: ["round", "flat"], default: "round" },
    invert: { type: "enum", options: ["raise", "carve", "replace"], default: "raise" },
  },
  nominalHeight: 12,
  controlPoints: { kind: "none", default: [] }, // analytic: the path is in `bezier`
  onCreate(s) {
    s.bezier = [bezierAnchor(v2(-40, 0)), bezierAnchor(v2(40, 0))];
  },
  // params: 13=width 14=slope 15=height 16=cap(0=round,1=flat) 17=invert(op, read in pack). slot 26 =
  // closed (loop last->first). Sides are linear (apply_profile kind 1); flat top where the ramp clamps to 1.
  wgsl: /* wgsl */ `
fn shape_ridge(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, SLOT_CP_START));
  let ac = u32(rec(base, SLOT_CP_COUNT));
  let width = rec(base, SLOT_PARAM0);
  let slope = rec(base, SLOT_PARAM1);
  let H = rec(base, SLOT_PARAM2);
  let flatCap = rec(base, SLOT_PARAM3) > 0.5;
  let closed = rec(base, SLOT_CLOSED) > 0.5 && ac >= 3u;
  let segs = select(ac - 1u, ac, closed);
  // per-anchor scale tapers the WHOLE cross-section (width+slope+height) as a unit, mixed along each
  // segment like the pipe's radius — track the sd-nearest segment's scale
  var minSd = 1e30;
  var bestS = 1.0;
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
    let dt = cubic_dist_t(p, p0, c0, c1, p1, cutS, cutE);
    let sLoc = mix(points[a0 + 3u].x, points[a1 + 3u].x, dt.y);
    let sdSeg = dt.x - width * sLoc;
    if (sdSeg < minSd) { minSd = sdSeg; bestS = sLoc; }
  }
  return vec2f(H * bestS * apply_profile(1u, -minSd, slope * bestS), minSd); // linear sides, flat top where it clamps to 1
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
    // per-anchor scale tapers the whole cross-section (width+slope+height) as a unit (mirrors the WGSL)
    let minSd = Infinity;
    let bestS = 1;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % b.length;
      const cutS = flatCap && !closed && i === 0;
      const cutE = flatCap && !closed && i + 2 === b.length;
      const { dist, t } = cubicNearest(p, b[i]!.p, ctrlOut(b[i]!), ctrlIn(b[i1]!), b[i1]!.p, cutS, cutE);
      const s0 = b[i]!.scale ?? 1;
      const s1 = b[i1]!.scale ?? 1;
      const sLoc = s0 + (s1 - s0) * t;
      const sdSeg = dist - width * sLoc;
      if (sdSeg < minSd) {
        minSd = sdSeg;
        bestS = sLoc;
      }
    }
    return { height: H * bestS * applyProfile("linear", -minSd, slope * bestS), sd: minSd };
  },
});
