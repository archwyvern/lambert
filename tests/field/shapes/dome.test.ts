import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

const dome = getShapeType("dome");
const inst = createShapeInstance("dome", v2(0, 0)); // hemisphere radius 48

test("hemisphere: peak = radius at center, zero at the rim", () => {
  expect(dome.eval(v2(0, 0), inst).height).toBeCloseTo(48);
  expect(dome.eval(v2(48, 0), inst).height).toBe(0);
  expect(dome.eval(v2(24, 0), inst).height).toBeCloseTo(48 * Math.sqrt(0.75));
});

test("circular footprint: sd is distance to the rim in any direction", () => {
  expect(dome.eval(v2(60, 0), inst).sd).toBeCloseTo(12);
  expect(dome.eval(v2(0, 60), inst).sd).toBeCloseTo(12);
  const d = 60 / Math.SQRT2;
  expect(dome.eval(v2(d, d), inst).sd).toBeCloseTo(12);
});

test("dome has no params: ellipse comes from transform scale", () => {
  expect(Object.keys(dome.params).length).toBe(0);
});
