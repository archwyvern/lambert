import type { MeshData } from "./types";
import { Vec2, v2 } from "./vec";

/** Unique undirected edges of a triangle mesh (each as the lower-then-higher index pair). */
export function meshEdges(mesh: MeshData): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const [a, b, c] of mesh.tris) {
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ] as Array<[number, number]>) {
      const k = x < y ? `${x}_${y}` : `${y}_${x}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(x < y ? [x, y] : [y, x]);
      }
    }
  }
  return out;
}

/**
 * Insert a vertex at fraction t along edge (ia, ib) and split every triangle using that
 * edge into two. Works for boundary edges (1 triangle) and interior edges (2). The new
 * vertex's xy and height are linearly interpolated along the edge.
 */
export function splitEdge(
  controlPoints: Vec2[],
  mesh: MeshData,
  ia: number,
  ib: number,
  t: number,
): { controlPoints: Vec2[]; mesh: MeshData; newIndex: number } {
  const a = controlPoints[ia]!;
  const b = controlPoints[ib]!;
  const nv = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  const nz = mesh.z[ia]! + (mesh.z[ib]! - mesh.z[ia]!) * t;
  const ni = controlPoints.length;
  const tris: Array<[number, number, number]> = [];
  for (const tri of mesh.tris) {
    if (tri.includes(ia) && tri.includes(ib)) {
      const third = tri.find((x) => x !== ia && x !== ib)!;
      tris.push([ia, ni, third]);
      tris.push([ni, ib, third]);
    } else {
      tris.push(tri);
    }
  }
  return { controlPoints: [...controlPoints, nv], mesh: { z: [...mesh.z, nz], tris }, newIndex: ni };
}

/**
 * Connect two vertices that are the opposite corners of a quad (two triangles sharing an
 * edge): flip the shared diagonal so the new edge runs between a and b. Returns null if the
 * two vertices don't form such a quad (e.g. they're already an edge, or unrelated). Winding
 * is irrelevant — the height eval's inside test is winding-agnostic.
 */
export function connectVerts(mesh: MeshData, a: number, b: number): MeshData | null {
  if (a === b) return null;
  for (let i = 0; i < mesh.tris.length; i++) {
    for (let j = 0; j < mesh.tris.length; j++) {
      if (i === j) continue;
      const t1 = mesh.tris[i]!;
      const t2 = mesh.tris[j]!;
      if (!t1.includes(a) || t1.includes(b) || !t2.includes(b) || t2.includes(a)) continue;
      const shared = t1.filter((x) => t2.includes(x));
      if (shared.length === 2) {
        const rest = mesh.tris.filter((_, k) => k !== i && k !== j);
        return { ...mesh, tris: [...rest, [a, b, shared[0]!], [a, b, shared[1]!]] };
      }
    }
  }
  return null;
}
