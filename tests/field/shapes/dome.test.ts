import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

const dome = getShapeType("dome");
const inst = createShapeInstance("dome", v2(0, 0)); // radiusX/Y 48, height 24

test("full height at center, zero at rim, zero outside", () => {
  expect(dome.eval(v2(0, 0), inst).height).toBeCloseTo(24);
  expect(dome.eval(v2(48, 0), inst).height).toBeCloseTo(0);
  expect(dome.eval(v2(60, 0), inst).height).toBe(0);
});

test("spherical profile: h(r/2) = h * sqrt(3)/2", () => {
  expect(dome.eval(v2(24, 0), inst).height).toBeCloseTo(24 * Math.sqrt(0.75));
});

test("sd sign and rim distance (circular case is exact)", () => {
  expect(dome.eval(v2(0, 0), inst).sd).toBeLessThanOrEqual(0);
  expect(dome.eval(v2(96, 0), inst).sd).toBeCloseTo(48);
});
