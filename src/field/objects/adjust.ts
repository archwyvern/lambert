import type { Vector2 } from "@carapace/primitives";
import { bakeRings, bezierAnchor } from "../bezier";
import { defineObjectType, ObjectTypeId } from "../registry";
import { sdPolygon } from "../sdf";
import type { FieldSample, ObjectInstance } from "../types";
import { v2 } from "../vec";

/**
 * Adjustment — a FILTER layer: no geometry of its own; it transforms the height accumulated by the
 * layers BELOW it (fold order), inside its region. The region is a Contour-style closed Bézier
 * outline (+ up to 6 holes, same machinery), DEFAULTING to a full-canvas box when placed from the
 * palette (see resolvePaletteObject). It hosts an ordered list of composable adjustments
 * (field/adjustments.ts) — add / multiply / clamp / curve / ramp — each blended by a strength:
 * out = mix(H, f(H), strength). The region edge honors the object's `aa` flag (hard by default).
 *
 * eval returns (0, region sd): the fold's op == adjust branch consumes ONLY the sd (coverage) and
 * applies the adjustment list to the accumulated H. It contributes mask coverage exactly where it
 * CHANGES the surface (delta-gated) — an emboss registers in the normal view and the NX alpha,
 * while a no-op transform over bare ground never un-gates the override.
 */
export function adjustEval(p: Vector2, object: ObjectInstance): FieldSample {
  const cps = object.controlPoints;
  const counts = object.contourCounts;
  const nB = counts?.[0] ?? object.ringSplit ?? cps.length;
  let sd = sdPolygon(p, nB < cps.length ? cps.slice(0, nB) : cps);
  if (counts && counts.length > 1) {
    let off = counts[0]!;
    for (let h = 1; h < counts.length && h <= 6; h++) {
      const hc = counts[h]!;
      if (hc >= 3) sd = Math.max(sd, -sdPolygon(p, cps.slice(off, off + hc))); // punch each hole out
      off += hc;
    }
  }
  return { height: 0, sd };
}

export const Adjust = defineObjectType({
  id: ObjectTypeId.Adjust,
  name: "Adjustment",
  category: "Special",
  params: {}, // the adjustment list lives in `adjustments`, packed as its own stream
  defaultCombine: "adjust",
  nominalHeight: 0,
  controlPoints: { kind: "rings", min: 3, default: [] }, // baked from the Bézier loop(s) in `bezier`
  onCreate(o) {
    // a sharp box (manual corner anchors); palette placement stretches it to the full canvas
    const c = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
    o.bezier = [c(-48, -48), c(48, -48), c(48, 48), c(-48, 48)];
    o.closed = true;
    const r = bakeRings(o.bezier, o.subpathStarts);
    o.controlPoints = r.controlPoints;
    o.ringSplit = r.ringSplit;
    o.contourCounts = r.contourCounts;
    o.adjustments = [];
  },
  // no params -> hole contour counts pack at SLOT_PARAM0.. (right after zero params); the
  // adjustment stream is read by fold_at via SLOT_TRI_START/COUNT, not here.
  wgsl: /* wgsl */ `
fn shape_adjustment(p: vec2f, base: u32) -> vec2f {
  let cs = u32(rec(base, SLOT_CP_START));
  let nB = u32(rec(base, SLOT_RING));
  var sd = sd_polygon(p, cs, nB);
  var off = cs + nB;
  for (var hi = 0u; hi < 6u; hi = hi + 1u) {
    let hc = u32(rec(base, SLOT_PARAM0 + hi));
    if (hc >= 3u) { sd = max(sd, -sd_polygon(p, off, hc)); }
    off = off + hc;
  }
  return vec2f(0.0, sd);
}
`,
  eval: adjustEval,
});
