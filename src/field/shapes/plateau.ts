import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";
import { sdPolygon } from "../sdf";
import { clamp, v2 } from "../vec";

/**
 * Frustum: a base ring at ground level and an independently draggable top rim at full
 * height. The surface interpolates between the two polygon SDFs — t = 0 at the base
 * edge, 1 at the top edge — so skewing the top ring tilts the slopes.
 */
export const Plateau = defineShapeType({
  id: "plateau",
  name: "Plateau",
  params: {
    height: { type: "px", default: 24, min: -256, max: 256 },
    profile: { type: "enum", options: PROFILE_KINDS, default: "linear" },
  },
  controlPoints: {
    kind: "rings",
    min: 3,
    default: [
      // base ring
      v2(-32, -32),
      v2(32, -32),
      v2(32, 32),
      v2(-32, 32),
      // top rim (full height inside this)
      v2(-20, -20),
      v2(20, -20),
      v2(20, 20),
      v2(-20, 20),
    ],
  },
  // params: 13=height 14=profile(enum idx). cps: first half = base ring, second = top rim
  wgsl: /* wgsl */ `
fn shape_plateau(p: vec2f, base: u32) -> vec2f {
  let h = rec(base, 13u);
  let prof = u32(rec(base, 14u));
  let cs = u32(rec(base, 11u));
  let n = u32(rec(base, 12u)) / 2u;
  let sdB = sd_polygon(p, cs, n);
  let sdT = sd_polygon(p, cs + n, n);
  let t = clamp(sdB / min(sdB - sdT, -1e-6), 0.0, 1.0);
  return vec2f(h * apply_profile(prof, t, 1.0), sdB);
}
`,
  eval(p, shape) {
    const h = numParam(shape, "height");
    const profile = enumParam(shape, "profile") as ProfileKind;
    const n = shape.controlPoints.length >> 1;
    const sdB = sdPolygon(p, shape.controlPoints.slice(0, n));
    const sdT = sdPolygon(p, shape.controlPoints.slice(n));
    // fraction across the slope band; degenerate (coincident rings) clamps to a step
    const t = clamp(sdB / Math.min(sdB - sdT, -1e-6), 0, 1);
    return { height: h * applyProfile(profile, t, 1), sd: sdB };
  },
});
