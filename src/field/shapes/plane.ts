import { defineShapeType } from "../registry";
import { numParam } from "../registry";
import { sdPolygon } from "../sdf";
import { v2 } from "../vec";

/**
 * Plane: a flat polygon footprint with a `tilt` (a unit-disc direction, set by the inspector's tilt
 * field). tilt ramps the height linearly across the footprint to make a custom slope — direction =
 * the way it slopes uphill, magnitude (0..1) = steepness (1 ~= 1px rise per 1px run). The ramp is
 * auto-biased so the footprint's LOWEST point sits on the ground (local 0) and rises from there, so
 * the slope is always non-negative regardless of tilt direction or how the polygon is edited. The
 * shape's elevation (gap to the ground) is the transform's position z, like every other shape;
 * tilt 0 = perfectly flat (no height) until raised or tilted.
 */
export const Plane = defineShapeType({
  id: "plane",
  name: "Plane",
  category: "Primitives",
  params: {
    tiltX: { type: "px", default: 0, min: -1, max: 1, step: 0.01, float: true },
    tiltY: { type: "px", default: 0, min: -1, max: 1, step: 0.01, float: true },
  },
  nominalHeight: 32, // hint only (a typical rise); the real peak is tilt-dependent
  controlPoints: {
    kind: "polygon",
    min: 3,
    default: [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32)],
  },
  // record slots: 13 = tiltX, 14 = tiltY; cpStart=11, cpCount=12 are the polygon verts.
  wgsl: /* wgsl */ `
fn shape_plane(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, 11u));
  let cc = u32(rec(base, 12u));
  let tx = rec(base, 13u);
  let ty = rec(base, 14u);
  var minDot = 1e30;
  for (var i = 0u; i < cc; i = i + 1u) {
    let v = points[cs + i];
    minDot = min(minDot, v.x * tx + v.y * ty);
  }
  let sd = sd_polygon(p, cs, cc);
  let h = p.x * tx + p.y * ty - minDot; // lowest vertex at 0; elevation (pos.z) is added by the fold
  return vec2f(h, sd);
}
`,
  eval(p, shape) {
    const cps = shape.controlPoints;
    const tx = numParam(shape, "tiltX");
    const ty = numParam(shape, "tiltY");
    let minDot = Infinity;
    for (const v of cps) minDot = Math.min(minDot, v.x * tx + v.y * ty);
    if (!Number.isFinite(minDot)) minDot = 0;
    return { height: p.x * tx + p.y * ty - minDot, sd: sdPolygon(p, cps) };
  },
});
