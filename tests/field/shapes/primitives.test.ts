import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

const evalAt = (id: string, x: number, y: number) =>
  getShapeType(id).eval(v2(x, y), createShapeInstance(id, v2(0, 0)));

test("cone: linear peak at centre, zero at rim, outward sd", () => {
  expect(evalAt("cone", 0, 0).height).toBeCloseTo(48);
  expect(evalAt("cone", 24, 0).height).toBeCloseTo(24); // half radius -> half height
  expect(evalAt("cone", 48, 0).height).toBeCloseTo(0);
  expect(evalAt("cone", 48, 0).sd).toBeCloseTo(0);
  expect(evalAt("cone", 60, 0).sd).toBeGreaterThan(0);
});

test("pyramid: square footprint, chebyshev linear slope", () => {
  expect(evalAt("pyramid", 0, 0).height).toBeCloseTo(48);
  expect(evalAt("pyramid", 24, 0).height).toBeCloseTo(24);
  expect(evalAt("pyramid", 24, 24).height).toBeCloseTo(24); // corner == edge (chebyshev)
  expect(evalAt("pyramid", 48, 48).sd).toBeCloseTo(0);
});

test("torus: peak on the ring centreline, flat hole + exterior", () => {
  expect(evalAt("torus", 48, 0).height).toBeCloseTo(16); // on the major radius
  expect(evalAt("torus", 48, 0).sd).toBeCloseTo(-16); // deepest inside the tube
  expect(evalAt("torus", 0, 0).height).toBe(0); // hole centre
  expect(evalAt("torus", 90, 0).height).toBe(0); // outside
});

test("wedge: ramps from -x (0) to +x (full) within the square", () => {
  expect(evalAt("wedge", -48, 0).height).toBeCloseTo(0);
  expect(evalAt("wedge", 0, 0).height).toBeCloseTo(12); // midpoint -> half of 24
  expect(evalAt("wedge", 48, 0).height).toBeCloseTo(24);
  expect(evalAt("wedge", 0, 60).sd).toBeGreaterThan(0); // outside the square
});

test("fillet: concave cove ramping -x (0) to +x (full), concave below linear", () => {
  expect(evalAt("fillet", -48, 0).height).toBeCloseTo(0);
  expect(evalAt("fillet", 48, 0).height).toBeCloseTo(24);
  expect(evalAt("fillet", 0, 0).height).toBeLessThan(12); // concave: below the linear midpoint
  expect(evalAt("fillet", 0, 60).sd).toBeGreaterThan(0); // outside the square footprint
});
