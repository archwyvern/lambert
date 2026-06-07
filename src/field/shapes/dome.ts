import { defineShapeType } from "../registry";
import { v2 } from "../vec";

/** Spherical cap on a circular footprint: nominal radius 48, ellipse via scale x/y. */
const R = 48;

export const Dome = defineShapeType({
  id: "dome",
  name: "Dome",
  params: {},
  nominalHeight: 24,
  controlPoints: { kind: "none", default: [] },
  // no params; footprint radius 48, tallness = 24 * scale.z
  wgsl: /* wgsl */ `
fn shape_dome(p: vec2f, base: u32) -> vec2f {
  let d2 = dot(p, p) / (48.0 * 48.0);
  var height = 0.0;
  if (d2 < 1.0) { height = 24.0 * sqrt(1.0 - d2); }
  return vec2f(height, length(p) - 48.0);
}
`,
  eval(p) {
    const d2 = (p.x * p.x + p.y * p.y) / (R * R);
    const height = d2 >= 1 ? 0 : 24 * Math.sqrt(1 - d2);
    return { height, sd: Math.hypot(p.x, p.y) - R };
  },
});

export const DOME_RADIUS = R;
export const domeBounds = () => ({ min: v2(-R, -R), max: v2(R, R) });
