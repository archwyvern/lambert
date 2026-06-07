import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

const plateau = getShapeType("plateau");
// defaults: square +/-32, height 24, slopeWidth 12, profile linear
const inst = createShapeInstance("plateau", v2(0, 0));

test("flat top where inside-distance exceeds slopeWidth", () => {
  expect(plateau.eval(v2(0, 0), inst).height).toBeCloseTo(24);
  expect(plateau.eval(v2(10, 5), inst).height).toBeCloseTo(24);
});

test("linear ramp on the slope", () => {
  // p=(26,0): inside = 6, t = 0.5 -> 12
  expect(plateau.eval(v2(26, 0), inst).height).toBeCloseTo(12);
});

test("zero outside, sd positive outside", () => {
  const s = plateau.eval(v2(40, 0), inst);
  expect(s.height).toBe(0);
  expect(s.sd).toBeCloseTo(8);
});

test("dragged vertices change the footprint", () => {
  const stretched = {
    ...inst,
    controlPoints: [v2(-64, -32), v2(32, -32), v2(32, 32), v2(-64, 32)],
  };
  expect(plateau.eval(v2(-58, 0), stretched).height).toBeCloseTo(12); // inside=6, t=0.5
});
