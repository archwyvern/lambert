import { Vector2 } from "../../math";
import { sdSegment } from "../sdf";
import { triBary } from "../tri";
import type { FieldSample, ObjectInstance } from "../types";

/**
 * Shared eval for every triangulated height-field object (Mesh). Height
 * at p is the barycentric interpolation across the triangle under it, blended toward Phong
 * tessellation by the `smoothness` param (0..1); outside every triangle, sd = distance to the
 * nearest mesh edge (the outline). Identical math on CPU and in `shape_meshfield` (gpu/wgsl.ts).
 */
export function meshFieldEval(p: Vector2, object: ObjectInstance): FieldSample {
  const m = object.mesh;
  const cps = object.controlPoints;
  if (!m || m.tris.length === 0) return { height: 0, sd: 1e9 };
  const sm = typeof object.params.smoothness === "number" ? object.params.smoothness : 0;
  for (const [a, b, c] of m.tris) {
    const bary = triBary(p, cps[a]!, cps[b]!, cps[c]!);
    if (bary === null) continue;
    const { u, v } = bary;
    const w = 1 - u - v;
    const hL = w * m.z[a]! + u * m.z[b]! + v * m.z[c]!;
    if (sm <= 0 || !m.grad) return { height: hL, sd: -1 };
    const plane = (i: number): number => {
      const g = m.grad![i]!;
      return m.z[i]! + g[0] * (p.x - cps[i]!.x) + g[1] * (p.y - cps[i]!.y);
    };
    const hP = w * plane(a) + u * plane(b) + v * plane(c);
    return { height: hL + sm * (hP - hL), sd: -1 };
  }
  let d = Infinity;
  for (const [a, b, c] of m.tris) {
    d = Math.min(d, sdSegment(p, cps[a]!, cps[b]!), sdSegment(p, cps[b]!, cps[c]!), sdSegment(p, cps[c]!, cps[a]!));
  }
  return { height: 0, sd: d };
}

/** Shared smoothness param + mesh control-point kind for every mesh-field object type. `float` lets
 *  the Inspector scrub the 0..1 Phong blend continuously — without it the field snaps to whole steps
 *  (only 0 or 1 reachable), which made smoothness effectively binary in the UI. */
export const MESH_PARAMS = { smoothness: { type: "px", default: 0, min: 0, max: 1, float: true } } as const;

