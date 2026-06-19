import { defineShapeType } from "../registry";

/** Circular cone: linear slope from a central apex to the rim (constant-slope normals,
 *  unlike the dome's curved falloff). Radius 48; tallness = 48 * scale.z. */
const R = 48;

export const Cone = defineShapeType({
  id: "cone",
  name: "Cone",
  category: "Primitives",
  params: {},
  nominalHeight: R,
  controlPoints: { kind: "none", default: [] },
  wgsl: /* wgsl */ `
fn shape_cone(p: vec2f, base: u32) -> vec2f {
  let r = length(p);
  return vec2f(48.0 * max(0.0, 1.0 - r / 48.0), r - 48.0);
}
`,
  eval(p) {
    const r = Math.hypot(p.x, p.y);
    return { height: R * Math.max(0, 1 - r / R), sd: r - R };
  },
});
