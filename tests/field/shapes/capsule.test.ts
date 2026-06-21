import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

// capsule defaults: length 64 (half 32), radius 16, profile round, nominal height 16
const capsule = getShapeType("capsule");
const inst = createShapeInstance("capsule", v2(0, 0));

test("capsule: peak on the centreline, zero at the rim", () => {
  expect(capsule.eval(v2(0, 0), inst).height).toBeCloseTo(16);
  expect(capsule.eval(v2(0, 16), inst).height).toBeCloseTo(0);
  expect(capsule.eval(v2(0, 24), inst).sd).toBeCloseTo(8);
});

test("capsule: rounded caps past the ends (radial from the cap centre)", () => {
  expect(capsule.eval(v2(48, 0), inst).sd).toBeCloseTo(0); // 48 - 32 = 16 = radius -> rim
  // (40,0): 8 past the half-length, 8 inside the radius -> round(0.5) = sqrt(0.75)
  expect(capsule.eval(v2(40, 0), inst).height).toBeCloseTo(16 * Math.sqrt(0.75));
});

test("capsule: round profile half-way up the cross-section", () => {
  // (0,8): inside 8 of radius 16, round(0.5) = sqrt(0.75)
  expect(capsule.eval(v2(0, 8), inst).height).toBeCloseTo(16 * Math.sqrt(0.75));
});

test("capsule: Z peak equals the radius (true semicircular cross-section)", () => {
  const small = createShapeInstance("capsule", v2(0, 0));
  small.params.radius = 8;
  expect(capsule.eval(v2(0, 0), small).height).toBeCloseTo(8); // peak height = radius
  expect(capsule.eval(v2(0, 4), small).height).toBeCloseTo(Math.sqrt(64 - 16)); // semicircle: sqrt(r^2 - d^2)
});

test("capsule has no editable vertices (parametric length/radius)", () => {
  expect(getShapeType("capsule").controlPoints.kind).toBe("none");
  expect(inst.controlPoints.length).toBe(0);
});
