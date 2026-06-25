import { bakeRingsUniform, bezierAnchor } from "../bezier";
import { PROFILE_KINDS } from "../profiles";
import { defineObjectType, ObjectTypeId } from "../registry";
import { v2 } from "../vec";
import { plateauEval, plateauWgsl } from "./plateau";

/**
 * Plateau (Vector) — the Bézier twin of the primitive Plateau: a base ring and a top rim, both CLOSED
 * Bézier loops (subpaths) baked into the two controlPoint rings the shared Plateau eval/WGSL consume
 * (base + top split at ringSplit, analytic distance ramp between them). `bezier` holds both loops
 * concatenated; `subpathStarts` marks the boundary; Gizmos rebakes the rings on every edit. Drawable
 * directly and produced by converting a Plateau.
 */
export const PlateauVector = defineObjectType({
  id: ObjectTypeId.PlateauVector,
  name: "Plateau (Vector)",
  category: "Vectors",
  params: {
    profile: { type: "enum", options: PROFILE_KINDS, default: "linear" },
  },
  nominalHeight: 24,
  controlPoints: { kind: "rings", min: 3, default: [] }, // baked from the two Bézier loops in `bezier`
  onCreate(o) {
    const baseLoop = [bezierAnchor(v2(-32, -32)), bezierAnchor(v2(32, -32)), bezierAnchor(v2(32, 32)), bezierAnchor(v2(-32, 32))];
    const topLoop = [bezierAnchor(v2(-20, -20)), bezierAnchor(v2(20, -20)), bezierAnchor(v2(20, 20)), bezierAnchor(v2(-20, 20))];
    o.bezier = [...baseLoop, ...topLoop];
    o.subpathStarts = [0, baseLoop.length];
    o.closed = true;
    const r = bakeRingsUniform(o.bezier, o.subpathStarts);
    o.controlPoints = r.controlPoints;
    o.ringSplit = r.ringSplit;
    o.contourCounts = r.contourCounts;
  },
  wgsl: plateauWgsl("shape_plateau_vector_"),
  eval: plateauEval,
});
