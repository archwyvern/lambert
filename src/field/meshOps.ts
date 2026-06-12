import type { MeshData } from "./types";
import { Vec2, v2 } from "./vec";

const sameEdge = (p: number, q: number, x: number, y: number): boolean =>
  (p === x && q === y) || (p === y && q === x);

/** Normalize to unique [lo,hi] pairs, dropping self-loops. */
function dedupeEdges(edges: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const [x, y] of edges) {
    const lo = Math.min(x, y);
    const hi = Math.max(x, y);
    if (lo !== hi && !seen.has(`${lo}_${hi}`)) {
      seen.add(`${lo}_${hi}`);
      out.push([lo, hi]);
    }
  }
  return out;
}

/** Every triangle edge as a unique undirected pair. */
function triEdges(tris: Array<[number, number, number]>): Array<[number, number]> {
  return dedupeEdges(tris.flatMap(([a, b, c]) => [[a, b], [b, c], [c, a]] as Array<[number, number]>));
}

/** Connectivity edges: the explicit set if present, else derived from the triangles (legacy). */
function edgesOf(mesh: MeshData): Array<[number, number]> {
  return dedupeEdges(mesh.edges ?? triEdges(mesh.tris));
}

/** Strict segment crossing (no shared endpoints, no collinear touch). */
function segCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const side = (o: Vec2, x: Vec2, y: Vec2): number => (x.x - o.x) * (y.y - o.y) - (x.y - o.y) * (y.x - o.x);
  const opp = (a: number, b: number): boolean => (a > 0 && b < 0) || (a < 0 && b > 0);
  return (
    opp(side(p3, p4, p1), side(p3, p4, p2)) && opp(side(p1, p2, p3), side(p1, p2, p4))
  );
}

/** All connectivity edges of the mesh (triangle edges + loose edges), as [lo,hi] pairs. */
export function meshEdges(mesh: MeshData): Array<[number, number]> {
  return edgesOf(mesh);
}

/**
 * Per-vertex height GRADIENT [dz/dx, dz/dy] in local space, from the area-weighted average of
 * adjacent face normals (in (x,y,height) space). Feeds the smoothness (Phong) interpolation —
 * each vertex's tangent plane. Vertices in no triangle get [0,0] (their gradient is never used).
 */
export function meshGradients(cps: Vec2[], z: number[], tris: Array<[number, number, number]>): Array<[number, number]> {
  const acc: Array<[number, number, number]> = cps.map(() => [0, 0, 0]); // accumulated face normals
  for (const [a, b, c] of tris) {
    const e1x = cps[b]!.x - cps[a]!.x, e1y = cps[b]!.y - cps[a]!.y, e1z = z[b]! - z[a]!;
    const e2x = cps[c]!.x - cps[a]!.x, e2y = cps[c]!.y - cps[a]!.y, e2z = z[c]! - z[a]!;
    let fx = e1y * e2z - e1z * e2y;
    let fy = e1z * e2x - e1x * e2z;
    let fz = e1x * e2y - e1y * e2x;
    if (fz < 0) { fx = -fx; fy = -fy; fz = -fz; } // orient +z up so heights increase upward
    for (const v of [a, b, c]) {
      const acc_v = acc[v]!;
      acc_v[0] += fx;
      acc_v[1] += fy;
      acc_v[2] += fz;
    }
  }
  return acc.map(([nx, ny, nz]) => {
    const nzs = Math.abs(nz!) < 1e-4 ? 1e-4 : nz!; // guard near-vertical / unused vertices
    return [-nx! / nzs, -ny! / nzs];
  });
}

/**
 * Insert a vertex at fraction t along edge (ia, ib): split it into ia-new + new-ib, and split
 * every triangle using that edge into two. Works for triangle edges (1 or 2 faces) and loose
 * edges (no face). The new vertex's xy and height are linearly interpolated along the edge.
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
  const connectors: Array<[number, number]> = [];
  for (const tri of mesh.tris) {
    if (tri.includes(ia) && tri.includes(ib)) {
      const third = tri.find((x) => x !== ia && x !== ib)!;
      tris.push([ia, ni, third]);
      tris.push([ni, ib, third]);
      connectors.push([ni, third]);
    } else {
      tris.push(tri);
    }
  }
  const edges = dedupeEdges([
    ...edgesOf(mesh).flatMap((e): Array<[number, number]> =>
      sameEdge(e[0], e[1], ia, ib) ? [[ia, ni], [ni, ib]] : [e],
    ),
    ...connectors,
  ]);
  return { controlPoints: [...controlPoints, nv], mesh: { z: [...mesh.z, nz], tris, edges }, newIndex: ni };
}

/**
 * Delete a set of vertices: drop them, drop every triangle/edge referencing any of them, and
 * re-index the survivors. Returns null if no triangle would remain to render (caller should
 * delete the whole shape).
 */
export function deleteVerts(
  controlPoints: Vec2[],
  mesh: MeshData,
  remove: number[],
): { controlPoints: Vec2[]; mesh: MeshData } | null {
  const del = new Set(remove);
  const remap = new Map<number, number>();
  const keep: number[] = [];
  controlPoints.forEach((_, i) => {
    if (!del.has(i)) {
      remap.set(i, keep.length);
      keep.push(i);
    }
  });
  const tris = mesh.tris
    .filter((tri) => tri.every((v) => !del.has(v)))
    .map((tri) => tri.map((v) => remap.get(v)!) as [number, number, number]);
  const edges = edgesOf(mesh)
    .filter(([p, q]) => !del.has(p) && !del.has(q))
    .map(([p, q]) => [remap.get(p)!, remap.get(q)!] as [number, number]);
  if (tris.length === 0) return null;
  return { controlPoints: keep.map((i) => controlPoints[i]!), mesh: { z: keep.map((i) => mesh.z[i]!), tris, edges } };
}

/**
 * Weld a set of vertices into `keep` (the right-clicked one): keep holds its own xy/height, every
 * edge/triangle referencing any of the others re-points to it, triangles that collapse to a line are
 * dropped, and the absorbed vertices are removed + re-indexed. Returns null if fewer than 2 verts,
 * `keep` isn't among them, or nothing renderable remains.
 */
export function mergeVerts(
  cps: Vec2[],
  mesh: MeshData,
  verts: number[],
  keep: number,
): { controlPoints: Vec2[]; mesh: MeshData } | null {
  if (verts.length < 2 || !verts.includes(keep)) return null;
  const group = new Set(verts);
  const map = (i: number): number => (group.has(i) ? keep : i);
  const tris = mesh.tris
    .map((t) => [map(t[0]), map(t[1]), map(t[2])] as [number, number, number])
    .filter((t) => t[0] !== t[1] && t[1] !== t[2] && t[2] !== t[0]); // drop collapsed faces
  const edges = dedupeEdges(edgesOf(mesh).map(([p, q]) => [map(p), map(q)] as [number, number]));
  // keep stays put; remove the absorbed verts and re-index the survivors
  return deleteVerts(cps, { z: mesh.z, tris, edges }, verts.filter((i) => i !== keep));
}

/** Remove an edge and any triangles using it; vertices stay (may become loose). */
export function deleteEdge(mesh: MeshData, ia: number, ib: number): MeshData {
  const edges = edgesOf(mesh).filter(([p, q]) => !sameEdge(p, q, ia, ib));
  const tris = mesh.tris.filter(
    (t) =>
      !([[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as Array<[number, number]>).some(([x, y]) => sameEdge(x, y, ia, ib)),
  );
  return { z: mesh.z, tris, edges };
}

/** Vertex indices sharing an edge with `i`. */
export function neighborsOf(mesh: MeshData, i: number): Set<number> {
  const n = new Set<number>();
  for (const [p, q] of edgesOf(mesh)) {
    if (p === i) n.add(q);
    if (q === i) n.add(p);
  }
  return n;
}

/**
 * Set `target`'s height onto the plane through the 3 `plane` vertices (their xyz), returning a new z[]
 * — or null if that plane is vertical (no unique height). Flattens a quad's two triangles coplanar by
 * moving the odd vertex out, leaving xy untouched.
 */
export function alignVertToPlane(
  cps: Vec2[],
  z: number[],
  plane: [number, number, number],
  target: number,
): number[] | null {
  const [i0, i1, i2] = plane;
  const p0 = cps[i0]!;
  const e1x = cps[i1]!.x - p0.x, e1y = cps[i1]!.y - p0.y, e1z = z[i1]! - z[i0]!;
  const e2x = cps[i2]!.x - p0.x, e2y = cps[i2]!.y - p0.y, e2z = z[i2]! - z[i0]!;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  if (Math.abs(nz) < 1e-9) return null; // vertical plane: no unique height for the target
  const t = cps[target]!;
  const tz = z[i0]! - (nx * (t.x - p0.x) + ny * (t.y - p0.y)) / nz;
  return z.map((zz, i) => (i === target ? tz : zz));
}

/**
 * Connect any two vertices with an edge. A triangular FACE forms only when the new edge closes a
 * 3-cycle (a vertex already connected to both endpoints) — otherwise it's just a loose edge. If
 * the new edge crosses an existing one, that edge and its triangles are removed first, so drawing
 * a quad's diagonal re-triangulates it instead of overlapping. Returns null if a===b or the two
 * are already connected.
 */
export function connectVerts(cps: Vec2[], mesh: MeshData, a: number, b: number): MeshData | null {
  if (a === b) return null;
  const edges = edgesOf(mesh);
  if (edges.some(([p, q]) => sameEdge(p, q, a, b))) return null; // already connected
  const A = cps[a]!;
  const B = cps[b]!;
  // drop any edge the new segment crosses (would overlap), plus triangles that used it
  const removed: Array<[number, number]> = [];
  const kept = edges.filter(([p, q]) => {
    if (p === a || p === b || q === a || q === b) return true; // shares an endpoint -> can't cross
    if (segCross(A, B, cps[p]!, cps[q]!)) {
      removed.push([p, q]);
      return false;
    }
    return true;
  });
  const tris = mesh.tris.filter(
    (t) =>
      !removed.some(([p, q]) =>
        ([[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as Array<[number, number]>).some(([x, y]) => sameEdge(x, y, p, q)),
      ),
  );
  const newEdges = dedupeEdges([...kept, [a, b]]);
  const neighbors = (v: number): Set<number> => {
    const s = new Set<number>();
    for (const [p, q] of newEdges) {
      if (p === v) s.add(q);
      if (q === v) s.add(p);
    }
    return s;
  };
  const nb = neighbors(b);
  for (const c of neighbors(a)) {
    if (c === b || !nb.has(c)) continue; // only a shared neighbor closes a triangle
    if (!tris.some((t) => t.includes(a) && t.includes(b) && t.includes(c))) tris.push([a, b, c]);
  }
  return { z: mesh.z, edges: newEdges, tris };
}
