import { defineShapeType } from "../registry";

/** Raised ring: a rounded (half-round) tube swept around a circle. Major radius 48,
 *  minor radius (tube) 16; tube height = 16 * scale.z. Footprint is the annulus only. */
const MAJOR = 48;
const MINOR = 16;

export const Torus = defineShapeType({
  id: "torus",
  name: "Torus",
  category: "Primitives",
  params: {},
  nominalHeight: MINOR,
  controlPoints: { kind: "none", default: [] },
  wgsl: /* wgsl */ `
fn shape_torus(p: vec2f, base: u32) -> vec2f {
  let dRing = abs(length(p) - 48.0);
  var height = 0.0;
  if (dRing < 16.0) {
    let t = dRing / 16.0;
    height = 16.0 * sqrt(1.0 - t * t);
  }
  return vec2f(height, dRing - 16.0);
}
`,
  eval(p) {
    const dRing = Math.abs(Math.hypot(p.x, p.y) - MAJOR);
    const t = dRing / MINOR;
    const height = dRing < MINOR ? MINOR * Math.sqrt(1 - t * t) : 0;
    return { height, sd: dRing - MINOR };
  },
});
