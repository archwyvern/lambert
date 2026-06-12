import { expect, test } from "vitest";
import {
  alignVertToPlane,
  connectVerts,
  deleteEdge,
  deleteVerts,
  mergeVerts,
  meshEdges,
  splitEdge,
} from "../../src/field/meshOps";
import type { MeshData } from "../../src/field/types";
import { v2 } from "../../src/field/vec";

// a unit quad as two triangles sharing the diagonal 0-2
const quadCps = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)];
const quad: MeshData = {
  z: [0, 0, 10, 10],
  tris: [[0, 1, 2], [0, 2, 3]],
  edges: [[0, 1], [1, 2], [0, 2], [2, 3], [0, 3]],
};

test("meshEdges: unique undirected edges", () => {
  const e = meshEdges(quad).map(([a, b]) => `${a}-${b}`).sort();
  expect(e).toEqual(["0-1", "0-2", "0-3", "1-2", "2-3"]); // 5 edges for 2 tris
});

test("splitEdge: boundary edge -> 1 triangle becomes 2, new vertex interpolated", () => {
  const r = splitEdge(quadCps, quad, 0, 1, 0.5); // edge 0-1 belongs to tri [0,1,2] only
  expect(r.newIndex).toBe(4);
  expect(r.controlPoints[4]).toEqual(v2(5, 0)); // midpoint of (0,0)-(10,0)
  expect(r.mesh.z[4]).toBe(0);
  expect(r.mesh.tris.length).toBe(3); // [0,1,2] split into 2, [0,2,3] untouched
  expect(r.mesh.tris).toContainEqual([0, 4, 2]);
  expect(r.mesh.tris).toContainEqual([4, 1, 2]);
  expect(r.mesh.tris).toContainEqual([0, 2, 3]);
});

test("splitEdge: interior shared edge -> both triangles split (2 -> 4)", () => {
  const r = splitEdge(quadCps, quad, 0, 2, 0.5); // diagonal shared by both tris
  expect(r.controlPoints[4]).toEqual(v2(5, 5));
  expect(r.mesh.z[4]).toBe(5); // (0 + 10)/2
  expect(r.mesh.tris.length).toBe(4);
});

test("connectVerts: drawing the other diagonal re-triangulates the quad (flip)", () => {
  const flipped = connectVerts(quadCps, quad, 1, 3);
  expect(flipped).not.toBeNull();
  expect(flipped!.tris.length).toBe(2);
  for (const tri of flipped!.tris) expect(tri.includes(1) && tri.includes(3)).toBe(true);
  // the crossed diagonal 0-2 is gone; the new edge 1-3 is present
  expect(flipped!.edges).toContainEqual([1, 3]);
  expect(flipped!.edges!.some(([a, b]) => a === 0 && b === 2)).toBe(false);
});

test("connectVerts: null when already connected or same vertex", () => {
  expect(connectVerts(quadCps, quad, 0, 2)).toBeNull(); // 0-2 is already an edge
  expect(connectVerts(quadCps, quad, 0, 0)).toBeNull();
});

test("connectVerts: closing a 3-cycle forms one triangular face", () => {
  // a path 0-1-2 (two edges, no face); connecting 0-2 closes the triangle
  const path: MeshData = { z: [0, 0, 0], tris: [], edges: [[0, 1], [1, 2]] };
  const pathCps = [v2(0, 0), v2(10, 0), v2(10, 10)];
  const r = connectVerts(pathCps, path, 0, 2);
  expect(r).not.toBeNull();
  expect(r!.tris.length).toBe(1);
  expect(r!.tris[0]!.includes(0) && r!.tris[0]!.includes(1) && r!.tris[0]!.includes(2)).toBe(true);
  expect(r!.edges).toContainEqual([0, 2]);
});

test("connectVerts: no shared neighbour -> a loose edge, no face", () => {
  const m: MeshData = { z: [0, 0, 0, 0], tris: [], edges: [] };
  const cps = [v2(0, 0), v2(10, 0), v2(0, 10), v2(10, 10)];
  const r = connectVerts(cps, m, 0, 3);
  expect(r).not.toBeNull();
  expect(r!.tris.length).toBe(0); // 0 and 3 share no neighbour -> no triangle
  expect(r!.edges).toContainEqual([0, 3]);
});

test("deleteVerts: drops the vertex + its triangles and re-indexes survivors", () => {
  // delete vertex 3 -> only tri [0,2,3] used it; tri [0,1,2] survives, re-indexed
  const r = deleteVerts(quadCps, quad, [3]);
  expect(r).not.toBeNull();
  expect(r!.controlPoints).toEqual([v2(0, 0), v2(10, 0), v2(10, 10)]);
  expect(r!.mesh.z).toEqual([0, 0, 10]);
  expect(r!.mesh.tris).toEqual([[0, 1, 2]]);
});

test("deleteVerts: returns null when no triangle would survive", () => {
  expect(deleteVerts(quadCps, quad, [0])).toBeNull(); // vertex 0 is in both triangles
});

test("mergeVerts: welds the others onto the kept (right-clicked) vertex, re-indexes", () => {
  const r = mergeVerts(quadCps, quad, [2, 3], 3); // merge 2 into 3
  expect(r).not.toBeNull();
  expect(r!.controlPoints.length).toBe(3);
  expect(r!.controlPoints).toContainEqual(v2(0, 10)); // survivor stays at vert 3, not the midpoint
  expect(r!.controlPoints).not.toContainEqual(v2(5, 10)); // never meets in the middle
  expect(r!.mesh.tris).toEqual([[0, 1, 2]]); // tri [0,2,3] collapsed away
});

test("mergeVerts: null without ≥2 verts or when keep isn't among them", () => {
  expect(mergeVerts(quadCps, quad, [1], 1)).toBeNull();
  expect(mergeVerts(quadCps, quad, [2, 3], 0)).toBeNull();
});

test("deleteEdge: drops the edge + every triangle using it; vertices untouched", () => {
  const r = deleteEdge(quad, 0, 2); // the shared diagonal -> both triangles die
  expect(r.tris).toEqual([]);
  expect(r.edges).not.toContainEqual([0, 2]);
  expect(r.z).toEqual(quad.z);
});

test("deleteEdge: a boundary edge kills only its own triangle", () => {
  const r = deleteEdge(quad, 0, 1); // edge 0-1 belongs to tri [0,1,2] only
  expect(r.tris).toEqual([[0, 2, 3]]);
  expect(r.edges).not.toContainEqual([0, 1]);
});

test("alignVertToPlane: sets the 4th vertex onto the plane through three", () => {
  // plane through verts 0,1,2 of the quad is z = y; vertex 3 at (0,10) should land at z = 10
  const z = alignVertToPlane(quadCps, [0, 0, 10, 5], [0, 1, 2], 3);
  expect(z).not.toBeNull();
  expect(z![3]).toBeCloseTo(10);
  expect(z!.slice(0, 3)).toEqual([0, 0, 10]); // the three plane verts are untouched
});

test("alignVertToPlane: null when the three are degenerate (no unique height)", () => {
  const cps = [v2(0, 0), v2(5, 0), v2(10, 0), v2(2, 5)]; // collinear in xy
  expect(alignVertToPlane(cps, [0, 5, 10, 0], [0, 1, 2], 3)).toBeNull();
});
