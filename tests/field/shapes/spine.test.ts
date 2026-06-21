import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

// groove (the remaining spine shape): depth 8, width 12 (halfWidth 6), round, spine (-32,0)..(32,0), carve
const groove = getShapeType("groove");
const ginst = createShapeInstance("groove", v2(0, 0));

test("groove: peak depth on the spine, zero at the rim, defaults to carve", () => {
  expect(groove.defaultCombine).toBe("carve");
  expect(groove.eval(v2(0, 0), ginst).height).toBeCloseTo(8);
  expect(groove.eval(v2(0, 6), ginst).height).toBeCloseTo(0);
});

test("groove: multi-segment polyline measures the nearest segment", () => {
  const bent = { ...ginst, controlPoints: [v2(-32, 0), v2(0, 0), v2(0, 32)] };
  // p=(3,20): nearest the vertical leg, inside 3 of halfWidth 6 -> round(0.5) = sqrt(0.75)
  expect(groove.eval(v2(3, 20), bent).height).toBeCloseTo(8 * Math.sqrt(0.75));
});
