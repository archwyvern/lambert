import { defineShapeType, numParam } from "../registry";
import { sdEllipse } from "../sdf";
import { v2 } from "../vec";

export const Dome = defineShapeType({
  id: "dome",
  name: "Dome",
  params: {
    radiusX: { type: "px", default: 48, min: 1 },
    radiusY: { type: "px", default: 48, min: 1 },
  },
  nominalHeight: 24,
  controlPoints: { kind: "none", default: [] },
  // params: 13=radiusX 14=radiusY (declaration order); tallness = 24 * scale.z
  wgsl: /* wgsl */ `
fn shape_dome(p: vec2f, base: u32) -> vec2f {
  let r = vec2f(rec(base, 13u), rec(base, 14u));
  let h = 24.0;
  let q = p / r;
  let d2 = dot(q, q);
  var height = 0.0;
  if (d2 < 1.0) { height = h * sqrt(1.0 - d2); }
  return vec2f(height, sd_ellipse(p, r));
}
`,
  eval(p, shape) {
    const rx = numParam(shape, "radiusX");
    const ry = numParam(shape, "radiusY");
    const h = 24;
    const qx = p.x / rx;
    const qy = p.y / ry;
    const d2 = qx * qx + qy * qy;
    const height = d2 >= 1 ? 0 : h * Math.sqrt(1 - d2);
    return { height, sd: sdEllipse(p, v2(rx, ry)) };
  },
});
