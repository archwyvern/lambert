import { expect, test } from "vitest";
import "../../src/field/objects";
import { bakeRings, bezierAnchor } from "../../src/field/bezier";
import { bakeToMesh, convertToVector } from "../../src/field/convert";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

test("bakeToMesh turns a Sphere into a Mesh that reproduces its height field", () => {
  const sphere = createObjectInstance(ObjectTypeId.Sphere, v2(0, 0)); // radius 48, round profile
  const mesh = bakeToMesh(sphere, { min: v2(-48, -48), max: v2(48, 48) });

  expect(mesh.typeId).toBe(ObjectTypeId.Mesh);
  expect(mesh.mesh).toBeDefined();
  expect(mesh.controlPoints.length).toBe(17 * 17); // (BAKE_N + 1)^2
  expect(mesh.bezier).toBeUndefined(); // a Mesh has no Bézier source

  const meshType = getObjectType(ObjectTypeId.Mesh);
  // a vertex sits exactly at the centre (i=j=8 over -50..50) -> the round sphere peaks at the radius
  expect(meshType.eval(v2(0, 0), mesh).height).toBeCloseTo(48, 0);
  // near the rim the baked field is low; well outside it is zero
  expect(meshType.eval(v2(46, 0), mesh).height).toBeLessThan(20);
  expect(meshType.eval(v2(60, 0), mesh).height).toBeCloseTo(0);
});

test("Surface (Vector) bakes its closed loop to a polygon footprint that fills", () => {
  const sv = createObjectInstance(ObjectTypeId.SurfaceVector, v2(0, 0));
  expect(sv.bezier?.length).toBe(4);
  expect(sv.closed).toBe(true);
  expect(sv.controlPoints.length).toBeGreaterThan(4); // dense baked polygon
  const t = getObjectType(ObjectTypeId.SurfaceVector);
  expect(t.eval(v2(0, 0), sv).sd).toBeLessThan(0); // inside the blob
  expect(t.eval(v2(80, 0), sv).sd).toBeGreaterThan(0); // outside
});

test("convertToVector: Pipe -> Pipe (Vector) straight stroke; Surface -> closed fill; Sphere -> null", () => {
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

  expect(convertToVector(createObjectInstance(ObjectTypeId.Sphere, v2(0, 0)))).toBeNull();
});

const sqCorner = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
const square = (cx: number, cy: number, h: number) => [sqCorner(cx - h, cy - h), sqCorner(cx + h, cy - h), sqCorner(cx + h, cy + h), sqCorner(cx - h, cy + h)];

test("Surface (Vector) with a hole: outer filled, inner subpath CSG-subtracted", () => {
  const sv = createObjectInstance(ObjectTypeId.SurfaceVector, v2(0, 0)); // rounded outer ~±30
  const next = [...sv.bezier!, ...square(0, 0, 12)];
  const subs = [0, sv.bezier!.length];
  const r = bakeRings(next, subs);
  const holed = { ...sv, bezier: next, subpathStarts: subs, controlPoints: r.controlPoints, ringSplit: r.ringSplit, contourCounts: r.contourCounts };
  const t = getObjectType(ObjectTypeId.SurfaceVector);
  expect(t.eval(v2(0, 0), holed).sd).toBeGreaterThan(0); // centre is in the hole -> outside the region
  expect(t.eval(v2(22, 0), holed).sd).toBeLessThan(0); // between hole and outer edge -> inside the fill
});

test("Surface (Vector) with TWO holes: both punched out, fill survives between them", () => {
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

test("convertToVector: Plateau -> Plateau (Vector) with baked base+top rings", () => {
  const pv = convertToVector(createObjectInstance(ObjectTypeId.Plateau, v2(0, 0)))!;
  expect(pv.typeId).toBe(ObjectTypeId.PlateauVector);
  expect(pv.subpathStarts).toEqual([0, 4]);
  expect(pv.ringSplit).toBeGreaterThan(0);
  const t = getObjectType(ObjectTypeId.PlateauVector);
  expect(t.eval(v2(0, 0), pv).height).toBeCloseTo(24, 0); // inside the top
});

test("convertToVector carries a Frustum's taper as per-anchor radii", () => {
  const frustum = createObjectInstance(ObjectTypeId.Pipe, v2(0, 0));
  frustum.params.cap = "flat";
  frustum.params.radius2 = 8; // taper 16 -> 8
  const fv = convertToVector(frustum)!;
  expect(fv.typeId).toBe(ObjectTypeId.PipeVector);
  expect(fv.bezier?.[0]?.radius).toBe(16);
  expect(fv.bezier?.[1]?.radius).toBe(8);
});
