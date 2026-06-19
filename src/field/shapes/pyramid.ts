import { defineShapeType } from "../registry";

/** Square pyramid: linear slope to a central apex over a square footprint (Chebyshev
 *  distance gives the four flat faces + diagonal ridges). Half-extent 48; tallness = 48 * scale.z. */
const R = 48;

export const Pyramid = defineShapeType({
  id: "pyramid",
  name: "Pyramid",
  category: "Primitives",
  params: {},
  nominalHeight: R,
  controlPoints: { kind: "none", default: [] },
  wgsl: /* wgsl */ `
fn shape_pyramid(p: vec2f, base: u32) -> vec2f {
  let d = max(abs(p.x), abs(p.y));
  return vec2f(48.0 * max(0.0, 1.0 - d / 48.0), d - 48.0);
}
`,
  eval(p) {
    const d = Math.max(Math.abs(p.x), Math.abs(p.y));
    return { height: R * Math.max(0, 1 - d / R), sd: d - R };
  },
});
