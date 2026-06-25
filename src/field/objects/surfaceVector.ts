import { bakeRings, bezierAnchor } from "../bezier";
import { defineObjectType, ObjectTypeId } from "../registry";
import { v2 } from "../vec";
import { surfaceEval, surfaceWgsl } from "./surface";

/**
 * Surface (Vector) — the Bézier twin of the primitive Surface: a filled CLOSED Bézier outline (+ tilt),
 * optionally with a HOLE (a second inner subpath, e.g. a Border/Frame). `bezier` holds the loop(s)
 * concatenated; `subpathStarts` marks the boundary; the loops bake into controlPoints with `ringSplit`
 * = the outer-ring count, so the shared Surface eval/WGSL fills the outer ring and CSG-subtracts the
 * hole. Gizmos rebakes on every edit (and "Add Hole" appends the inner loop). Drawable directly and
 * produced by converting a Surface.
 */
export const SurfaceVector = defineObjectType({
  id: ObjectTypeId.SurfaceVector,
  name: "Surface (Vector)",
  category: "Vectors",
  params: {
    tiltX: { type: "px", default: 0, min: -1, max: 1, step: 0.01, float: true },
    tiltY: { type: "px", default: 0, min: -1, max: 1, step: 0.01, float: true },
  },
  nominalHeight: 32,
  controlPoints: { kind: "rings", min: 3, default: [] }, // baked from the Bézier loop(s) in `bezier`
  onCreate(o) {
    // a rounded blob (smooth closed loop) — visibly the Bézier sibling of the sharp primitive Surface
    o.bezier = [bezierAnchor(v2(-30, -30)), bezierAnchor(v2(30, -30)), bezierAnchor(v2(30, 30)), bezierAnchor(v2(-30, 30))];
    o.closed = true;
    const r = bakeRings(o.bezier, o.subpathStarts);
    o.controlPoints = r.controlPoints;
    o.ringSplit = r.ringSplit; // = the whole loop (no hole) until "Add Hole"
    o.contourCounts = r.contourCounts;
  },
  wgsl: surfaceWgsl("shape_surface_vector_", true),
  eval: surfaceEval,
});
