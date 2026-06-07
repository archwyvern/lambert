import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

// ridge defaults: height 16, width 24 (halfWidth 12), profile round, spine (-32,0)..(32,0)
const ridge = getShapeType("ridge");
const rinst = createShapeInstance("ridge", v2(0, 0));

test("ridge: peak on the spine, zero at the rim", () => {
  expect(ridge.eval(v2(0, 0), rinst).height).toBeCloseTo(16);
  expect(ridge.eval(v2(0, 12), rinst).height).toBeCloseTo(0);
  expect(ridge.eval(v2(0, 20), rinst).sd).toBeCloseTo(8);
});

test("ridge: round profile half-way up", () => {
  // p=(0,6): inside = 6 of halfWidth 12, round(0.5) = sqrt(0.75)
  expect(ridge.eval(v2(0, 6), rinst).height).toBeCloseTo(16 * Math.sqrt(0.75));
});

test("ridge: multi-segment polyline measures nearest segment", () => {
  const bent = { ...rinst, controlPoints: [v2(-32, 0), v2(0, 0), v2(0, 32)] };
  expect(ridge.eval(v2(6, 20), bent).height).toBeCloseTo(16 * Math.sqrt(0.75));
});

test("groove: same geometry, defaults to carve", () => {
  const groove = getShapeType("groove");
  const ginst = createShapeInstance("groove", v2(0, 0)); // depth 8, width 12
  expect(getShapeType("groove").defaultCombine).toBe("carve");
  expect(groove.eval(v2(0, 0), ginst).height).toBeCloseTo(8);
  expect(groove.eval(v2(0, 6), ginst).height).toBeCloseTo(0);
});
