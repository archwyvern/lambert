import { expect, test } from "vitest";
import "../../../src/field/objects";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

const evalAt = (id: string, x: number, y: number, params?: Record<string, number | string | boolean>) => {
  const o = createObjectInstance(id, v2(0, 0));
  if (params) Object.assign(o.params, params);
  return getObjectType(id).eval(v2(x, y), o);
};

test("sphere as Cone (linear profile): linear peak at centre, zero at rim, outward sd", () => {
  const cone = { profile: "linear" as const };
  expect(evalAt(ObjectTypeId.Sphere, 0, 0, cone).height).toBeCloseTo(48);
  expect(evalAt(ObjectTypeId.Sphere, 24, 0, cone).height).toBeCloseTo(24); // half radius -> half height
  expect(evalAt(ObjectTypeId.Sphere, 48, 0, cone).height).toBeCloseTo(0);
  expect(evalAt(ObjectTypeId.Sphere, 48, 0, cone).sd).toBeCloseTo(0);
  expect(evalAt(ObjectTypeId.Sphere, 60, 0, cone).sd).toBeGreaterThan(0);
});

test("torus: peak on the ring centreline, flat hole + exterior", () => {
  expect(evalAt(ObjectTypeId.Torus, 48, 0).height).toBeCloseTo(16); // on the major radius
  expect(evalAt(ObjectTypeId.Torus, 48, 0).sd).toBeCloseTo(-16); // deepest inside the tube
  expect(evalAt(ObjectTypeId.Torus, 0, 0).height).toBe(0); // hole centre
  expect(evalAt(ObjectTypeId.Torus, 90, 0).height).toBe(0); // outside
});

test("ramp as Wedge (linear): ramps from -x (0) to +x (full) within the square", () => {
  expect(evalAt(ObjectTypeId.Ramp, -48, 0).height).toBeCloseTo(0);
  expect(evalAt(ObjectTypeId.Ramp, 0, 0).height).toBeCloseTo(12); // midpoint -> half of 24
  expect(evalAt(ObjectTypeId.Ramp, 48, 0).height).toBeCloseTo(24);
  expect(evalAt(ObjectTypeId.Ramp, 0, 60).sd).toBeGreaterThan(0); // outside the square
});

test("ramp as Fillet (cove): concave ramp, below the linear midpoint", () => {
  const fillet = { profile: "cove" as const };
  expect(evalAt(ObjectTypeId.Ramp, -48, 0, fillet).height).toBeCloseTo(0);
  expect(evalAt(ObjectTypeId.Ramp, 48, 0, fillet).height).toBeCloseTo(24);
  expect(evalAt(ObjectTypeId.Ramp, 0, 0, fillet).height).toBeLessThan(12); // concave: below the linear midpoint
  expect(evalAt(ObjectTypeId.Ramp, 0, 60, fillet).sd).toBeGreaterThan(0); // outside the square footprint
});
