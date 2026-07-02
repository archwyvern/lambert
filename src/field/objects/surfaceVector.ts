import { bakeRings, bezierAnchor } from "../bezier";
import { defineObjectType, ObjectTypeId } from "../registry";
import { v2 } from "../vec";
import { surfaceEval, surfaceWgsl } from "./surface";

/**
 * Contour — the Bézier twin of the primitive Surface: a filled CLOSED Bézier outline (+ tilt),
 * optionally with a HOLE (a second inner subpath, e.g. a Border/Frame). `bezier` holds the loop(s)
 * concatenated; `subpathStarts` marks the boundary; the loops bake into controlPoints with `ringSplit`
 * = the outer-ring count, so the shared Surface eval/WGSL fills the outer ring and CSG-subtracts the
 * hole. Gizmos rebakes on every edit (and "Add Hole" appends the inner loop). Drawable directly and
 * produced by converting a Surface.
 */
export const SurfaceVector = defineObjectType({
  id: ObjectTypeId.SurfaceVector,
  name: "Contour",
  category: "Paths",
  params: {
    tiltX: { type: "px", default: 0, min: -1, max: 1, float: true },
    tiltY: { type: "px", default: 0, min: -1, max: 1, float: true },
  },
  nominalHeight: 32,
  controlPoints: { kind: "rings", min: 3, default: [] }, // baked from the Bézier loop(s) in `bezier`
  onCreate(o) {
    // a sharp square (manual corner anchors) — matching its primitive sibling Plate; smooth the
    // corners per-anchor when a rounded outline is wanted
    const c = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
    o.bezier = [c(-30, -30), c(30, -30), c(30, 30), c(-30, 30)];
    o.closed = true;
    const r = bakeRings(o.bezier, o.subpathStarts);
    o.controlPoints = r.controlPoints;
    o.ringSplit = r.ringSplit; // = the whole loop (no hole) until "Add Hole"
    o.contourCounts = r.contourCounts;
  },
  wgsl: surfaceWgsl("shape_contour", true),
  eval: surfaceEval,
});
