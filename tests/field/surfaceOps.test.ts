import { expect, test } from "vitest";
import { createSurface, deleteSurfaceVerts, insertVertOnEdge, surfaceEdges } from "../../src/field/surfaceOps";
import { v2 } from "../../src/field/vec";

test("createSurface: centroid as pos, verts relative, one face spanning all", () => {
  const s = createSurface([v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)]);
  expect(s.typeId).toBe("surface");
  expect(s.transform.pos).toEqual({ x: 5, y: 5, z: 0 });
  expect(s.controlPoints).toEqual([v2(-5, -5), v2(5, -5), v2(5, 5), v2(-5, 5)]);
  expect(s.surface!.faces[0]!.loop).toEqual([0, 1, 2, 3]);
});

test("surfaceEdges: one edge per loop segment", () => {
  const s = createSurface([v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)]).surface!;
  const e = surfaceEdges(s).map((x) => `${x.a}-${x.b}`);
  expect(e).toEqual(["0-1", "1-2", "2-3", "3-0"]);
});

test("insertVertOnEdge: splits the loop, interpolates position", () => {
  const cps = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)];
  const surface = { faces: [{ loop: [0, 1, 2, 3], color: "#fff" }] };
  const r = insertVertOnEdge(cps, surface, 0, 1, 0.5);
  expect(r.newIndex).toBe(4);
  expect(r.controlPoints[4]).toEqual(v2(5, 0));
  expect(r.surface.faces[0]!.loop).toEqual([0, 4, 1, 2, 3]);
});

test("deleteSurfaceVerts: removes from loop + re-indexes; drops shape when a face dies", () => {
  const cps = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)];
  const surface = { faces: [{ loop: [0, 1, 2, 3], color: "#fff" }] };
  const r = deleteSurfaceVerts(cps, surface, [1]);
  expect(r).not.toBeNull();
  expect(r!.controlPoints).toEqual([v2(0, 0), v2(10, 10), v2(0, 10)]);
  expect(r!.surface.faces[0]!.loop).toEqual([0, 1, 2]);
  // deleting down to <3 verts kills the only face -> null
  expect(deleteSurfaceVerts(cps, surface, [1, 2])).toBeNull();
});
