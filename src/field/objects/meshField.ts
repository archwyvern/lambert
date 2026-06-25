import { Vector2 } from "@carapace/primitives";
import { meshEdges } from "../meshOps";
import { sdSegment } from "../sdf";
import { triBary } from "../tri";
import type { FieldSample, MeshData, ObjectInstance } from "../types";
import { v2 } from "../vec";

/**
 * Shared eval for every triangulated height-field object (Mesh, Grid, Revolve, Loft, Noise). Height
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

/** Shared smoothness param + mesh control-point kind for every mesh-field object type. */
export const MESH_PARAMS = { smoothness: { type: "px", default: 0, min: 0, max: 1, step: 0.05 } } as const;

/** Build a regular (n+1)×(n+1) vertex grid spanning [-r, r]², height from `zf(x, y)`. Shared by the
 *  grid-derived seeds (Grid = flat, Noise = fractal, Revolve = radial profile). */
export function gridMesh(n: number, r: number, zf: (x: number, y: number) => number): { controlPoints: Vector2[]; mesh: MeshData } {
  const controlPoints: Vector2[] = [];
  const z: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -r + (2 * r * i) / n;
      const y = -r + (2 * r * j) / n;
      controlPoints.push(v2(x, y));
      z.push(zf(x, y));
    }
  }
  const idx = (i: number, j: number): number => j * (n + 1) + i;
  const tris: [number, number, number][] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      tris.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
      tris.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
    }
  }
  return { controlPoints, mesh: { z, tris, edges: meshEdges({ z, tris }) } };
}
