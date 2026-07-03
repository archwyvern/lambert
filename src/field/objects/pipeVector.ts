import { bezierAnchor, ctrlIn, ctrlOut, cubicNearest, resolveHandles, resolveHandlesClosed } from "../bezier";
import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, numParam, ObjectTypeId } from "../registry";
import { v2 } from "../vec";

/**
 * Cable — a profiled tube swept along a Bézier path (SVG's `stroke` paint), evaluated
 * analytically (per-pixel cubic distance, so it stays smooth at any zoom). The Bézier twin of the
 * primitive Pipe. `radius` is the 3D tube radius — both the footprint half-width AND the peak height
 * for a round profile (a true half-tube), since this is a height field, not a 2D stroke. `profile`
 * shapes the cross-section; `cap` flat-cuts the open ends (round leaves them domed); `invert` carves
 * instead of raising (the fold op reads the invert param). `closed` joins the last anchor to the first
 * (an O-ring) — caps don't apply then. The path lives in ObjectInstance.bezier and controlPoints stays
 * empty, so the packer ships the anchors for the GPU's analytic eval.
 *
 * Subsumes Cable / Groove (invert) / Rib (raise) / Frustum (per-anchor scale taper — edit it with the
 * vertex tool's anchor-scale handle or the Inspector's "anchor scale" field).
 */
export const PipeVector = defineObjectType({
  id: ObjectTypeId.PipeVector,
  name: "Cable",
  category: "Paths",
  params: {
    radius: { type: "px", default: 8, min: 1, float: true },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
    cap: { type: "enum", options: ["round", "flat"], default: "round" },
    invert: { type: "enum", options: ["raise", "carve", "replace"], default: "raise" },
  },
  nominalHeight: 16,
  controlPoints: { kind: "none", default: [] }, // analytic: the path is in `bezier`
  onCreate(s) {
    s.bezier = [bezierAnchor(v2(-40, 0)), bezierAnchor(v2(40, 0))];
  },
  // anchors pack 4 vec2 each: p, hIn, hOut, (scale, pad). params: 13=radius 14=profile
  // 15=cap(0=round,1=flat) 16=invert. slot 26 = closed (loop last->first). The cross-section radius is
  // radius·scale, the per-anchor scale interpolated per segment (a Frustum converts in by setting the
  // end scales); carve from invert (pack).
  wgsl: /* wgsl */ `
fn shape_cable(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, SLOT_CP_START));
  let ac = u32(rec(base, SLOT_CP_COUNT));
  let prof = u32(rec(base, SLOT_PARAM1));
  let flatCap = rec(base, SLOT_PARAM2) > 0.5;
  let closed = (u32(rec(base, SLOT_CLOSED)) & 1u) == 1u && ac >= 3u; // bit0 (bit1 = edge AA)
  let segs = select(ac - 1u, ac, closed);
  var minSd = 1e30;
  var bestR = rec(base, SLOT_PARAM0);
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
    let localR = rec(base, SLOT_PARAM0) * mix(points[a0 + 3u].x, points[a1 + 3u].x, dt.y);
    let sdSeg = dt.x - localR;
    if (sdSeg < minSd) { minSd = sdSeg; bestR = localR; }
  }
  return vec2f(bestR * apply_profile(prof, -minSd, bestR), minSd);
}
`,
  eval(p, object) {
    if (!object.bezier || object.bezier.length < 2) return { height: 0, sd: 1e9 };
    const closed = !!object.closed && object.bezier.length >= 3;
    const b = closed ? resolveHandlesClosed(object.bezier) : resolveHandles(object.bezier);
    const rDefault = numParam(object, "radius");
    const prof = enumParam(object, "profile") as ProfileKind;
    const flatCap = enumParam(object, "cap") === "flat";
    const segs = closed ? b.length : b.length - 1;
    let minSd = Infinity;
    let bestR = rDefault;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % b.length;
      const cutS = flatCap && !closed && i === 0;
      const cutE = flatCap && !closed && i + 2 === b.length;
      const { dist, t } = cubicNearest(p, b[i]!.p, ctrlOut(b[i]!), ctrlIn(b[i1]!), b[i1]!.p, cutS, cutE);
      const s0 = b[i]!.scale ?? 1;
      const s1 = b[i1]!.scale ?? 1;
      const localR = rDefault * (s0 + (s1 - s0) * t);
      const sdSeg = dist - localR;
      if (sdSeg < minSd) {
        minSd = sdSeg;
        bestR = localR;
      }
    }
    return { height: bestR * applyProfile(prof, -minSd, bestR), sd: minSd };
  },
});
