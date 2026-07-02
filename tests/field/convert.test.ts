import { expect, test } from "vitest";
import "../../src/field/objects";
import { bakeRings, bezierAnchor } from "../../src/field/bezier";
import { bakeToMesh, canBakeToMesh, convertToVector } from "../../src/field/convert";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

test("bakeToMesh: a flat Surface quad becomes EXACTLY 2 triangles at the tilt plane", () => {
  const surf = createObjectInstance(ObjectTypeId.Surface, v2(0, 0)); // default square polygon
  const mesh = bakeToMesh(surf);
  expect(mesh.typeId).toBe(ObjectTypeId.Mesh);
  expect(mesh.controlPoints.length).toBe(4);
  expect(mesh.mesh!.tris.length).toBe(2); // the headline: quad -> 2 tris, not a 512-tri grid
  expect(mesh.mesh!.z.every((z) => z === 0)).toBe(true); // untilted = flat on the ground
  const meshType = getObjectType(ObjectTypeId.Mesh);
  expect(meshType.eval(v2(0, 0), mesh).sd).toBeLessThan(0); // interior covered
});

test("bakeToMesh: a Plateau becomes base ring + top ring + side facets + top cap", () => {
  const plat = createObjectInstance(ObjectTypeId.Plateau, v2(0, 0)); // 4-vert base + 4-vert top
  const mesh = bakeToMesh(plat);
  expect(mesh.controlPoints.length).toBe(8);
  // 8 side facets (two per quad side) + 2 top-cap tris
  expect(mesh.mesh!.tris.length).toBe(10);
  const meshType = getObjectType(ObjectTypeId.Mesh);
  expect(meshType.eval(v2(0, 0), mesh).height).toBeCloseTo(24, 3); // full height inside the top rim
  expect(meshType.eval(v2(-26, 0), mesh).height).toBeGreaterThan(0); // on the slope band
  expect(meshType.eval(v2(-26, 0), mesh).height).toBeLessThan(24);
});

test("canBakeToMesh: flat sources only — curved primitives are excluded", () => {
  expect(canBakeToMesh(createObjectInstance(ObjectTypeId.Surface, v2(0, 0)))).toBe(true);
  expect(canBakeToMesh(createObjectInstance(ObjectTypeId.Plateau, v2(0, 0)))).toBe(true);
  for (const id of [ObjectTypeId.Sphere, ObjectTypeId.Pipe, ObjectTypeId.Torus, ObjectTypeId.Ramp, ObjectTypeId.Mesh]) {
    expect(canBakeToMesh(createObjectInstance(id, v2(0, 0))), id).toBe(false);
  }
});
test("Contour bakes its closed loop to a polygon footprint that fills", () => {
  const sv = createObjectInstance(ObjectTypeId.SurfaceVector, v2(0, 0));
  expect(sv.bezier?.length).toBe(4);
  expect(sv.closed).toBe(true);
  expect(sv.controlPoints.length).toBe(4); // sharp corner square bakes to exactly its 4 corners
  const t = getObjectType(ObjectTypeId.SurfaceVector);
  expect(t.eval(v2(0, 0), sv).sd).toBeLessThan(0); // inside the blob
  expect(t.eval(v2(80, 0), sv).sd).toBeGreaterThan(0); // outside
});

test("convertToVector: Pipe -> Cable straight stroke; Surface -> closed fill; Sphere -> Pillow circle", () => {
  const pv = convertToVector(createObjectInstance(ObjectTypeId.Pipe, v2(0, 0)))!;
  expect(pv.typeId).toBe(ObjectTypeId.PipeVector);
  expect(pv.bezier?.length).toBe(2);
  expect(pv.controlPoints.length).toBe(0); // analytic stroke

  const surf = createObjectInstance(ObjectTypeId.Surface, v2(0, 0)); // square -32..32
  const sv = convertToVector(surf)!;
  expect(sv.typeId).toBe(ObjectTypeId.SurfaceVector);
  expect(sv.bezier?.length).toBe(4);
  expect(sv.closed).toBe(true);
  const t = getObjectType(ObjectTypeId.SurfaceVector);
  expect(t.eval(v2(0, 0), sv).sd).toBeLessThan(0); // inside
  expect(t.eval(v2(50, 0), sv).sd).toBeGreaterThan(0); // outside

  // Sphere -> Pillow: a 4-anchor Bezier circle at the sphere's radius, balloon relief
  const pillow = convertToVector(createObjectInstance(ObjectTypeId.Sphere, v2(0, 0)))!;
  expect(pillow.typeId).toBe(ObjectTypeId.Pillow);
  expect(pillow.bezier?.length).toBe(4);
  expect(pillow.closed).toBe(true);
  const pt = getObjectType(ObjectTypeId.Pillow);
  expect(pt.eval(v2(0, 0), pillow).sd).toBeLessThan(0); // inside the circle
  expect(pt.eval(v2(0, 0), pillow).height).toBeGreaterThan(10); // inflated at the centre
  expect(pt.eval(v2(60, 0), pillow).height).toBe(0); // flat outside (radius 48)

  expect(convertToVector(createObjectInstance(ObjectTypeId.Torus, v2(0, 0)))).toBeNull(); // no Path twin
});

const sqCorner = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
const square = (cx: number, cy: number, h: number) => [sqCorner(cx - h, cy - h), sqCorner(cx + h, cy - h), sqCorner(cx + h, cy + h), sqCorner(cx - h, cy + h)];

test("Contour with a hole: outer filled, inner subpath CSG-subtracted", () => {
  const sv = createObjectInstance(ObjectTypeId.SurfaceVector, v2(0, 0)); // rounded outer ~±30
  const next = [...sv.bezier!, ...square(0, 0, 12)];
  const subs = [0, sv.bezier!.length];
  const r = bakeRings(next, subs);
  const holed = { ...sv, bezier: next, subpathStarts: subs, controlPoints: r.controlPoints, ringSplit: r.ringSplit, contourCounts: r.contourCounts };
  const t = getObjectType(ObjectTypeId.SurfaceVector);
  expect(t.eval(v2(0, 0), holed).sd).toBeGreaterThan(0); // centre is in the hole -> outside the region
  expect(t.eval(v2(22, 0), holed).sd).toBeLessThan(0); // between hole and outer edge -> inside the fill
});

test("Contour with TWO holes: both punched out, fill survives between them", () => {
  const sv = createObjectInstance(ObjectTypeId.SurfaceVector, v2(0, 0)); // rounded outer ~±30
  const outer = sv.bezier!;
  const next = [...outer, ...square(-16, 0, 6), ...square(16, 0, 6)]; // two holes left + right
  const subs = [0, outer.length, outer.length + 4];
  const r = bakeRings(next, subs);
  const holed = { ...sv, bezier: next, subpathStarts: subs, controlPoints: r.controlPoints, ringSplit: r.ringSplit, contourCounts: r.contourCounts };
  const t = getObjectType(ObjectTypeId.SurfaceVector);
  expect(r.contourCounts.length).toBe(3); // outer + 2 holes
  expect(t.eval(v2(-16, 0), holed).sd).toBeGreaterThan(0); // inside the left hole -> outside the region
  expect(t.eval(v2(16, 0), holed).sd).toBeGreaterThan(0); // inside the right hole -> outside the region
  expect(t.eval(v2(0, 0), holed).sd).toBeLessThan(0); // between the holes -> inside the fill
});

test("convertToVector: Plateau -> Mesa with baked base+top rings", () => {
  const pv = convertToVector(createObjectInstance(ObjectTypeId.Plateau, v2(0, 0)))!;
  expect(pv.typeId).toBe(ObjectTypeId.PlateauVector);
  expect(pv.subpathStarts).toEqual([0, 4]);
  expect(pv.ringSplit).toBeGreaterThan(0);
  const t = getObjectType(ObjectTypeId.PlateauVector);
  expect(t.eval(v2(0, 0), pv).height).toBeCloseTo(24, 0); // inside the top
});

test("convertToVector carries a Frustum's taper as per-anchor SCALES (radius·scale model)", () => {
  const frustum = createObjectInstance(ObjectTypeId.Pipe, v2(0, 0));
  frustum.params.cap = "flat";
  frustum.params.radius2 = 8; // taper 16 -> 8
  const fv = convertToVector(frustum)!;
  expect(fv.typeId).toBe(ObjectTypeId.PipeVector);
  expect(fv.params.radius).toBe(16);
  expect(fv.bezier?.[0]?.scale).toBeUndefined(); // start at full cross-section
  expect(fv.bezier?.[1]?.scale).toBeCloseTo(0.5, 6); // 8/16
});
