import { expect, test } from "vitest";
import "../../src/field/objects";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../src/field/registry";
import { meshEdges, meshGradients } from "../../src/field/meshOps";
import type { MeshData, ObjectInstance } from "../../src/field/types";
import { v2 } from "../../src/field/vec";

test("mesh primitive seeds a flat quad on the ground: 4 corners at +/-32, height 0, 2 triangles", () => {
  const mesh = createObjectInstance(ObjectTypeId.Mesh, v2(64, 64));
  expect(mesh.typeId).toBe(ObjectTypeId.Mesh);
  expect(mesh.controlPoints).toEqual([v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32)]);
  expect(mesh.mesh!.z).toEqual([0, 0, 0, 0]); // a fresh mesh starts flat on the ground
  expect(mesh.mesh!.tris).toEqual([
    [0, 1, 2],
    [0, 2, 3],
  ]);
  expect(mesh.mesh!.edges!.length).toBeGreaterThan(0); // edges derived for the gizmo
});

test("mesh eval: flat-on-ground inside the quad, zero outside with the right outline distance", () => {
  const mesh = createObjectInstance(ObjectTypeId.Mesh, v2(64, 64));
  const type = getObjectType(ObjectTypeId.Mesh);
  expect(type.eval(v2(0, 0), mesh).height).toBe(0); // flat at the ground until sculpted
  const out = type.eval(v2(40, 0), mesh);
  expect(out.height).toBe(0);
  expect(out.sd).toBeCloseTo(8); // 8px outside the +/-32 edge
});

/** A 5-vertex pyramid mesh: 4 corners on the ground + a centre peak, fanned into 4 facets. */
function pyramid(): ObjectInstance {
  const mesh = createObjectInstance(ObjectTypeId.Mesh, v2(64, 64));
  mesh.controlPoints = [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32), v2(0, 0)];
  const z = [0, 0, 0, 0, 24];
  const tris: [number, number, number][] = [
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ];
  mesh.mesh = { z, tris, edges: meshEdges({ z, tris } as MeshData) };
  return mesh;
}

test("mesh eval: a sloped facet interpolates linearly toward the peak", () => {
  const type = getObjectType(ObjectTypeId.Mesh);
  // (16,0) is 1/2 of the way from the right-edge midpoint (z 0) to the peak (z 24) -> 12
  expect(type.eval(v2(16, 0), pyramid()).height).toBeCloseTo(12);
});

test("mesh smoothness: Phong blend is linear in the slider and bends the facet", () => {
  const mesh = pyramid();
  const type = getObjectType(ObjectTypeId.Mesh);
  // the real path attaches mesh.grad in evalCpu; do the same here for the direct eval
  const grad = meshGradients(mesh.controlPoints, mesh.mesh!.z, mesh.mesh!.tris);
  const withGrad = { ...mesh, mesh: { ...mesh.mesh!, grad } };
  const at = (sm: number): number => type.eval(v2(16, 0), { ...withGrad, params: { smoothness: sm } }).height;
  const flat = at(0);
  const smooth = at(1);
  expect(flat).toBeCloseTo(12); // linear mid-slope
  expect(at(0.5)).toBeCloseTo((flat + smooth) / 2, 4); // h = hL + sm*(hP-hL): linear in the slider
  expect(Math.abs(smooth - flat)).toBeGreaterThan(0.05); // Phong actually curves the surface
});
