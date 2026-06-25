import { expect, test } from "vitest";
import "../../../src/field/objects";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

const sphere = getObjectType(ObjectTypeId.Sphere);
const inst = createObjectInstance(ObjectTypeId.Sphere, v2(0, 0)); // hemisphere, default radius 48

test("hemisphere: peak = radius at center, zero at the rim", () => {
  expect(sphere.eval(v2(0, 0), inst).height).toBeCloseTo(48);
  expect(sphere.eval(v2(48, 0), inst).height).toBe(0);
  expect(sphere.eval(v2(24, 0), inst).height).toBeCloseTo(48 * Math.sqrt(0.75));
});

test("circular footprint: sd is distance to the rim in any direction", () => {
  expect(sphere.eval(v2(60, 0), inst).sd).toBeCloseTo(12);
  expect(sphere.eval(v2(0, 60), inst).sd).toBeCloseTo(12);
  const d = 60 / Math.SQRT2;
  expect(sphere.eval(v2(d, d), inst).sd).toBeCloseTo(12);
});

test("radius param scales the footprint and the peak height", () => {
  expect(Object.keys(sphere.params)).toEqual(["radius", "profile"]);
  const small = { ...inst, params: { radius: 20, profile: "round" } };
  expect(sphere.eval(v2(0, 0), small).height).toBeCloseTo(20); // peak = radius
  expect(sphere.eval(v2(20, 0), small).sd).toBeCloseTo(0); // rim at the radius
  expect(sphere.eval(v2(30, 0), small).sd).toBeCloseTo(10);
});
