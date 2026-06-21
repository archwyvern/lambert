import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

// cylinder defaults: length 64 (half 32), radius 16, profile round
const cyl = getShapeType("cylinder");
const inst = createShapeInstance("cylinder", v2(0, 0));

test("cylinder: flat caps — full height up to the end, nothing past it", () => {
  expect(cyl.eval(v2(0, 0), inst).height).toBeCloseTo(16); // peak = radius
  expect(cyl.eval(v2(31, 0), inst).height).toBeCloseTo(16); // still full just inside the cap
  expect(cyl.eval(v2(40, 0), inst).height).toBeCloseTo(0); // past the flat cap (a capsule would round here)
});

test("cylinder: semicircular cross-section (round profile)", () => {
  expect(cyl.eval(v2(0, 16), inst).height).toBeCloseTo(0); // side rim
  expect(cyl.eval(v2(0, 8), inst).height).toBeCloseTo(16 * Math.sqrt(0.75)); // sqrt(r^2 - y^2)
});

test("cylinder: length/radius are float params, no editable vertices", () => {
  expect(cyl.controlPoints.kind).toBe("none");
  expect(inst.controlPoints.length).toBe(0);
});
