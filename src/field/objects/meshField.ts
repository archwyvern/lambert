import { Vector2 } from "@carapace/primitives";
import { triBary } from "../tri";
import type { FieldSample, ObjectInstance } from "../types";

/**
 * Hard-cover margin around the mesh outline, in DOC pixels. A mesh is traced along a sprite's
 * silhouette, but the sprite's own boundary pixels (the artist's line raster along that exact
 * edge) have centers up to 1/sqrt(2) ~ 0.71px OUTSIDE the polygon on diagonals — a strict
 * center-inside test leaves them mask-less (a jagged uncovered fringe between the fill and the
 * gizmo outline). Any pixel center within this margin of an edge is treated as covered, taking
 * the CLAMPED edge height (no extrapolation). Overhang past the sprite is invisible: the normal
 * view gates by diffuse alpha and the NX export clears alpha where the diffuse is transparent.
 */
export const HARD_COVER_PX = 0.75;

/**
 * Shared eval for every triangulated height-field object (Mesh). Height
 * at p is the barycentric interpolation across the triangle under it, blended toward Phong
 * tessellation by the `smoothness` param (0..1). Triangles may OVERLAP (a vertex dragged across
 * an opposite edge folds the sheet over — the angled-view reading, like Plateau's crossed rims):
 * the HIGHEST containing triangle's surface wins, so the fold tucks under the top face instead
 * of z-fighting on array order. Outside every triangle but within HARD_COVER_PX (doc px —
 * `scaleHint` converts) of the nearest edge, the pixel is still covered with that edge point's
 * height; beyond that, sd = distance to the nearest mesh edge (the outline). Identical math on
 * CPU and in `shape_meshfield` (gpu/wgsl.ts).
 */
export function meshFieldEval(p: Vector2, object: ObjectInstance, scaleHint = 1): FieldSample {
  const m = object.mesh;
  const cps = object.controlPoints;
  if (!m || m.tris.length === 0) return { height: 0, sd: 1e9 };
  const sm = typeof object.params.smoothness === "number" ? object.params.smoothness : 0;
  const plane = (i: number, q: Vector2): number => {
    const g = m.grad![i]!;
    return m.z[i]! + g[0] * (q.x - cps[i]!.x) + g[1] * (q.y - cps[i]!.y);
  };
  let best = -Infinity;
  for (const [a, b, c] of m.tris) {
    const bary = triBary(p, cps[a]!, cps[b]!, cps[c]!);
    if (bary === null) continue;
    const { u, v } = bary;
    const w = 1 - u - v;
    const hL = w * m.z[a]! + u * m.z[b]! + v * m.z[c]!;
    const h = sm <= 0 || !m.grad ? hL : hL + sm * (w * plane(a, p) + u * plane(b, p) + v * plane(c, p) - hL);
    best = Math.max(best, h);
  }
  if (best > -Infinity) return { height: best, sd: -1 };
  // Outside every triangle: nearest point on any edge (distance + edge param + endpoints).
  let bestD = Infinity;
  let bestI = 0;
  let bestJ = 0;
  let bestT = 0;
  for (const [a, b, c] of m.tris) {
    for (const [i, j] of [[a, b], [b, c], [c, a]] as const) {
      const pa = p.sub(cps[i]!);
      const ba = cps[j]!.sub(cps[i]!);
      const t = Math.min(1, Math.max(0, pa.dot(ba) / ba.lengthSquared()));
      const d = pa.sub(ba.scale(t)).length();
      if (d < bestD) {
        bestD = d;
        bestI = i;
        bestJ = j;
        bestT = t;
      }
    }
  }
  if (bestD * scaleHint <= HARD_COVER_PX) {
    const hL = m.z[bestI]! + (m.z[bestJ]! - m.z[bestI]!) * bestT;
    if (sm <= 0 || !m.grad) return { height: hL, sd: -1 };
    const q = cps[bestI]!.add(cps[bestJ]!.sub(cps[bestI]!).scale(bestT));
    const hP = plane(bestI, q) + (plane(bestJ, q) - plane(bestI, q)) * bestT;
    return { height: hL + sm * (hP - hL), sd: -1 };
  }
  return { height: 0, sd: bestD };
}

/** Shared smoothness param + mesh control-point kind for every mesh-field object type. `float` lets
 *  the Inspector scrub the 0..1 Phong blend continuously — without it the field snaps to whole steps
 *  (only 0 or 1 reachable), which made smoothness effectively binary in the UI. */
export const MESH_PARAMS = { smoothness: { type: "px", default: 0, min: 0, max: 1, float: true } } as const;

