import { expect, test } from "vitest";
import "../../../src/field/objects";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

// Berm (Vector): width 16, slope 6, height 12, straight path (-40,0)..(40,0). Flat top spans |d| < 10.
const berm = getObjectType(ObjectTypeId.BermVector);
const inst = createObjectInstance(ObjectTypeId.BermVector, v2(0, 0));

test("berm (vector): flat top at `height`, linear sides over `slope`, zero at the edge", () => {
  expect(berm.eval(v2(0, 0), inst).height).toBeCloseTo(12); // on the spine: flat top
  expect(berm.eval(v2(0, 10), inst).height).toBeCloseTo(12); // d=10, inside 6 == slope -> still the top edge
  expect(berm.eval(v2(0, 13), inst).height).toBeCloseTo(6); // d=13, inside 3, linear 0.5 -> half height
  const rim = berm.eval(v2(0, 16), inst); // d == width
  expect(rim.sd).toBeCloseTo(0);
  expect(rim.height).toBeCloseTo(0);
});

test("berm (vector) exposes invert + cap (invert drives the fold op)", () => {
  expect(berm.defaultCombine).toBeUndefined();
  expect(Object.keys(berm.params)).toContain("invert");
});

// primitive Berm: a straight bar (length 80, half 40) with the same flat-top trapezoid cross-section.
const prim = getObjectType(ObjectTypeId.Berm);

test("berm (primitive): flat top + linear sides about the centreline, cut at the flat-cap ends", () => {
  const p = createObjectInstance(ObjectTypeId.Berm, v2(0, 0)); // default flat cap
  expect(prim.eval(v2(0, 0), p).height).toBeCloseTo(12); // centreline: flat top
  expect(prim.eval(v2(0, 13), p).height).toBeCloseTo(6); // inside 3 of slope 6 -> half
  expect(prim.eval(v2(0, 16), p).height).toBeCloseTo(0); // at the width edge
  expect(prim.eval(v2(50, 0), p).height).toBeCloseTo(0); // past the flat cap (half-length 40)
});
