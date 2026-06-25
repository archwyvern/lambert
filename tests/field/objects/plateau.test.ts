import { expect, test } from "vitest";
import "../../../src/field/objects";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

const plateau = getObjectType(ObjectTypeId.Plateau);
// defaults: base ring +/-32, top rim +/-20, height 24, profile linear
const inst = createObjectInstance(ObjectTypeId.Plateau, v2(0, 0));

test("flat top inside the top rim", () => {
  expect(plateau.eval(v2(0, 0), inst).height).toBeCloseTo(24);
  expect(plateau.eval(v2(10, 5), inst).height).toBeCloseTo(24);
  expect(plateau.eval(v2(20, 0), inst).height).toBeCloseTo(24); // on the rim edge
});

test("linear ramp across the slope band", () => {
  // p=(26,0): sdB = -6, sdT = 6 -> t = 0.5 -> 12
  expect(plateau.eval(v2(26, 0), inst).height).toBeCloseTo(12);
});

test("zero outside, sd positive outside (sd = base footprint)", () => {
  const s = plateau.eval(v2(40, 0), inst);
  expect(s.height).toBe(0);
  expect(s.sd).toBeCloseTo(8);
});

test("dragging both rings moves the footprint and the flat top", () => {
  const stretched = {
    ...inst,
    controlPoints: [
      v2(-64, -32), v2(32, -32), v2(32, 32), v2(-64, 32),
      v2(-52, -20), v2(20, -20), v2(20, 20), v2(-52, 20),
    ],
  };
  expect(plateau.eval(v2(-58, 0), stretched).height).toBeCloseTo(12); // mid-band on the stretched side
  expect(plateau.eval(v2(-40, 0), stretched).height).toBeCloseTo(24); // inside the stretched top
});

test("corner crease: base vertex lofts straight to its paired top vertex", () => {
  // (26,26) on the loft line from base corner (32,32) to top corner (20,20), halfway -> t = 0.5
  expect(plateau.eval(v2(26, 26), inst).height).toBeCloseTo(12);
  // off-crease inside the right face: planar loft across the band -> t = 3/12
  expect(plateau.eval(v2(29, 0), inst).height).toBeCloseTo(24 * (3 / 12));
});

test("Plateau (Vector) bakes two closed loops into base+top rings and ramps like Plateau", () => {
  const pv = createObjectInstance(ObjectTypeId.PlateauVector, v2(0, 0));
  expect(pv.subpathStarts).toEqual([0, 4]);
  expect(pv.ringSplit).toBeGreaterThan(0);
  const t = getObjectType(ObjectTypeId.PlateauVector);
  expect(t.eval(v2(0, 0), pv).height).toBeCloseTo(24, 0); // inside the top rim -> full height
  expect(t.eval(v2(50, 0), pv).height).toBeCloseTo(0); // outside the base
});

test("single top vertex makes a pyramid (apex at full height)", () => {
  const pyr = {
    ...inst,
    controlPoints: [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32), v2(0, 0)],
    ringSplit: 4,
  };
  expect(plateau.eval(v2(0, 0), pyr).height).toBeCloseTo(24); // the apex
  expect(plateau.eval(v2(32, 0), pyr).height).toBeCloseTo(0); // base edge
  expect(plateau.eval(v2(16, 0), pyr).height).toBeCloseTo(12); // sdB -16, sdT 16 -> t 0.5
});

test("skewed top rim tilts one slope without touching the other", () => {
  // top rim pushed +8 in x: the left band widens (shallower), the right narrows (steeper)
  const skewed = {
    ...inst,
    controlPoints: [
      v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32),
      v2(-12, -20), v2(28, -20), v2(28, 20), v2(-12, 20),
    ],
  };
  // left band spans -32..-12 (width 20): p=(-22,0) -> t = 0.5 -> 12
  expect(plateau.eval(v2(-22, 0), skewed).height).toBeCloseTo(12);
  // right band spans 28..32 (width 4): p=(30,0) -> t = 0.5 -> 12, but p=(26,0) is full height
  expect(plateau.eval(v2(30, 0), skewed).height).toBeCloseTo(12);
  expect(plateau.eval(v2(26, 0), skewed).height).toBeCloseTo(24);
});
