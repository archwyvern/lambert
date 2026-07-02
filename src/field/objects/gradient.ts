import { Vector2 } from "@carapace/primitives";
import { defineObjectType, numParam, ObjectTypeId } from "../registry";
import { sdPolygon } from "../sdf";
import type { FieldSample, ObjectInstance } from "../types";
import { v2 } from "../vec";

/**
 * Gradient — the first EFFECT layer (QC-REQ-5 prototype): a rectangular region (defaulting to the
 * whole image at creation — see resolvePaletteObject in App) that contributes a directional height
 * ramp, 0 at one side rising to `depth` at the other along `angle`. In the normal map this reads as
 * a directional emboss across the region. Deliberately non-tiltable / param-minimal.
 *
 * PROTOTYPE compositing finding: this contributes to the height field through the ordinary fold
 * (cheapest model). A true adjustment layer (modifying the composited field beneath) needs a second
 * compositing pass — the refine-phase design question this prototype exists to inform. Emboss is
 * implemented in HEIGHT space (a ramp): the derived normals then carry the directional bias exactly,
 * which is the well-defined half of "emboss"; a normal-space push would break height/normal
 * consistency (the exporter derives normals FROM heights).
 */
export function gradientEval(p: Vector2, object: ObjectInstance): FieldSample {
  const cps = object.controlPoints;
  const sd = sdPolygon(p, cps);
  const a = (numParam(object, "angle") * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let minP = Infinity;
  let maxP = -Infinity;
  for (const q of cps) {
    const t = q.x * dx + q.y * dy;
    minP = Math.min(minP, t);
    maxP = Math.max(maxP, t);
  }
  const span = Math.max(maxP - minP, 1e-6);
  const t = Math.min(1, Math.max(0, (p.x * dx + p.y * dy - minP) / span));
  return { height: numParam(object, "depth") * t, sd };
}

export const Gradient = defineObjectType({
  id: ObjectTypeId.Gradient,
  name: "Gradient",
  category: "Effects",
  params: {
    angle: { type: "px", default: 90, min: 0, max: 360, float: true },
    depth: { type: "px", default: 12, min: 0, float: true },
  },
  nominalHeight: 12,
  controlPoints: {
    kind: "polygon",
    min: 3,
    default: [v2(-48, -48), v2(48, -48), v2(48, 48), v2(-48, 48)],
  },
  // params: 13 = angle (deg), 14 = depth. The ramp normalises across the region's own extent along
  // the gradient direction, so resizing the region rescales the ramp with it (mirrors gradientEval).
  wgsl: /* wgsl */ `
fn shape_gradient(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, SLOT_CP_START));
  let cc = u32(rec(base, SLOT_CP_COUNT));
  let a = rec(base, SLOT_PARAM0) * 0.017453292519943295;
  let dir = vec2f(cos(a), sin(a));
  var minP = 1e30;
  var maxP = -1e30;
  for (var i = 0u; i < cc; i = i + 1u) {
    let t = dot(points[cs + i], dir);
    minP = min(minP, t);
    maxP = max(maxP, t);
  }
  let span = max(maxP - minP, 1e-6);
  let t = clamp((dot(p, dir) - minP) / span, 0.0, 1.0);
  let sd = sd_polygon(p, cs, cc);
  return vec2f(rec(base, SLOT_PARAM1) * t, sd);
}
`,
  eval: gradientEval,
});
