import { defineShapeType } from "../registry";
import { clamp } from "../vec";

/** Concave cove: over a square footprint, the height rises along +x with a CONCAVE
 *  (quarter-round) profile — a fillet between a floor (-x) and a wall (+x). Rotate to aim it.
 *  Half-extent 48; full height = 24 * scale.z. */
const R = 48;
const H = 24;

export const Fillet = defineShapeType({
  id: "fillet",
  name: "Fillet",
  category: "Profiles",
  params: {},
  nominalHeight: H,
  controlPoints: { kind: "none", default: [] },
  wgsl: /* wgsl */ `
fn shape_fillet(p: vec2f, base: u32) -> vec2f {
  let sd = max(abs(p.x) - 48.0, abs(p.y) - 48.0);
  var height = 0.0;
  if (sd <= 0.0) {
    let t = clamp((p.x + 48.0) / 96.0, 0.0, 1.0);
    height = 24.0 * (1.0 - sqrt(max(0.0, 1.0 - t * t)));
  }
  return vec2f(height, sd);
}
`,
  eval(p) {
    const sd = Math.max(Math.abs(p.x) - R, Math.abs(p.y) - R);
    let height = 0;
    if (sd <= 0) {
      const t = clamp((p.x + R) / (2 * R), 0, 1);
      height = H * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
    }
    return { height, sd };
  },
});
