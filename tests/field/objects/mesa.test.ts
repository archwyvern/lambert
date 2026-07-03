import { expect, test } from "vitest";
import "../../../src/field/objects";
import { bakeRings, bezierAnchor } from "../../../src/field/bezier";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import type { ObjectInstance } from "../../../src/field/types";
import { v2 } from "../../../src/field/vec";

const mesa = getObjectType(ObjectTypeId.PlateauVector);
const corner = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");

function mesaFrom(base: [number, number][], top: [number, number][]): ObjectInstance {
  const inst = createObjectInstance(ObjectTypeId.PlateauVector, v2(0, 0));
  inst.bezier = [...base.map(([x, y]) => corner(x, y)), ...top.map(([x, y]) => corner(x, y))];
  inst.subpathStarts = [0, base.length];
  inst.closed = true;
  const r = bakeRings(inst.bezier, inst.subpathStarts);
  inst.controlPoints = r.controlPoints;
  inst.ringSplit = r.ringSplit;
  inst.contourCounts = r.contourCounts;
  return inst;
}

test("mesa: flat top inside the inner rim, 0 outside, smooth soft-distance slope between", () => {
  const inst = mesaFrom(
    [[-32, -32], [32, -32], [32, 32], [-32, 32]],
    [[-16, -16], [16, -16], [16, 16], [-16, 16]],
  );
  inst.params.profile = "linear";
  expect(mesa.eval(v2(0, 0), inst).height).toBe(24); // inside the top rim: full height
  expect(mesa.eval(v2(40, 0), inst).height).toBe(0); // outside the base
  // along the slope band the height rises monotonically toward the rim
  const h = (x: number): number => mesa.eval(v2(x, 0), inst).height;
  expect(h(30)).toBeGreaterThan(0);
  expect(h(30)).toBeLessThan(h(24));
  expect(h(24)).toBeLessThan(h(18));
  expect(h(18)).toBeLessThanOrEqual(24);
});

test("mesa: base and top rings with DIFFERENT anchor counts work (no pairing constraint)", () => {
  // 5-corner base, 3-corner top — the old loft required equal dense counts (bakeRingsUniform)
  const inst = mesaFrom(
    [[-32, -32], [0, -40], [32, -32], [32, 32], [-32, 32]],
    [[-10, -10], [10, -10], [0, 12]],
  );
  inst.params.profile = "linear";
  expect(mesa.eval(v2(0, 0), inst).height).toBe(24); // inside the triangle top
  expect(mesa.eval(v2(0, -50), inst).height).toBe(0);
  const slope = mesa.eval(v2(24, 0), inst).height;
  expect(slope).toBeGreaterThan(0);
  expect(slope).toBeLessThan(24);
});
