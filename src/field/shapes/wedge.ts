import { defineShapeType } from "../registry";
import { clamp } from "../vec";

/** Directional ramp: a square footprint whose height rises linearly from the -x edge (0) to
 *  the +x edge (full). Rotate to aim the slope. Half-extent 48; tallness = 24 * scale.z. */
const R = 48;
const H = 24;

export const Wedge = defineShapeType({
  id: "wedge",
  name: "Wedge",
  category: "Profiles",
  params: {},
  nominalHeight: H,
  controlPoints: { kind: "none", default: [] },
  wgsl: /* wgsl */ `
fn shape_wedge(p: vec2f, base: u32) -> vec2f {
  let sd = max(abs(p.x) - 48.0, abs(p.y) - 48.0);
  var height = 0.0;
  if (sd <= 0.0) { height = 24.0 * clamp((p.x + 48.0) / 96.0, 0.0, 1.0); }
  return vec2f(height, sd);
}
`,
  eval(p) {
    const sd = Math.max(Math.abs(p.x) - R, Math.abs(p.y) - R);
    const height = sd <= 0 ? H * clamp((p.x + R) / (2 * R), 0, 1) : 0;
    return { height, sd };
  },
});
