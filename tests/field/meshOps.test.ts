import { expect, test } from "vitest";
import { connectVerts, meshEdges, splitEdge } from "../../src/field/meshOps";
import type { MeshData } from "../../src/field/types";
import { v2 } from "../../src/field/vec";

// a unit quad as two triangles sharing the diagonal 0-2
const quadCps = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)];
const quad: MeshData = { z: [0, 0, 10, 10], tris: [[0, 1, 2], [0, 2, 3]] };

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

test("connectVerts: flips the quad diagonal from 0-2 to 1-3", () => {
  const flipped = connectVerts(quad, 1, 3);
  expect(flipped).not.toBeNull();
  expect(flipped!.tris.length).toBe(2);
  // every triangle now contains both 1 and 3 (the new diagonal)
  for (const tri of flipped!.tris) expect(tri.includes(1) && tri.includes(3)).toBe(true);
});

test("connectVerts: returns null when the verts don't form a flippable quad", () => {
  expect(connectVerts(quad, 0, 2)).toBeNull(); // 0-2 is already the shared edge
  expect(connectVerts(quad, 0, 0)).toBeNull();
});
