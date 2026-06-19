import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import { alignedToAxis, snapHalf, snapShapeToGrid } from "../../src/field/snap";
import { fromLocal } from "../../src/field/transform";
import { v2 } from "../../src/field/vec";
import { Vector3 } from "@carapace/primitives";

test("snapHalf snaps to the nearest whole or half", () => {
  expect(snapHalf(0.24)).toBe(0);
  expect(snapHalf(0.25)).toBe(0.5);
  expect(snapHalf(0.74)).toBe(0.5);
  expect(snapHalf(0.75)).toBe(1);
  expect(snapHalf(-0.3)).toBe(-0.5);
  expect(snapHalf(10)).toBe(10);
});

test("snapShapeToGrid puts position + every vertex's canvas position on the ½px grid", () => {
  const s = createShapeInstance("plateau", v2(40.3, 48.8));
  s.transform.pos = s.transform.pos.withZ(5.2);
  s.transform.rotation = 0.37;
  s.transform.scale = new Vector3(1.3, 1.3, 1.3);
  s.controlPoints = [v2(0.2, -0.4), v2(2.6, 2.9), v2(-5.1, 7.3)];
  const snapped = snapShapeToGrid(s);
  expect(snapped.transform.pos).toEqual({ x: 40.5, y: 49, z: 5 });
  for (const cp of snapped.controlPoints) {
    const world = fromLocal(snapped.transform, cp);
    expect(world.x * 2).toBeCloseTo(Math.round(world.x * 2)); // a multiple of ½
    expect(world.y * 2).toBeCloseTo(Math.round(world.y * 2));
  }
  expect(snapped.transform.rotation).toBe(0.37); // untouched
  expect(snapped.transform.scale).toEqual({ x: 1.3, y: 1.3, z: 1.3 }); // untouched
});

test("alignedToAxis fires on every 45° axis (0,45,90,...,315) at any length, not off-axis", () => {
  // long edges exactly on each of the 8 axes — fire regardless of length
  const axes = [v2(1, 0), v2(1, 1), v2(0, 1), v2(-1, 1), v2(-1, 0), v2(-1, -1), v2(0, -1), v2(1, -1)];
  for (const d of axes) expect(alignedToAxis(v2(0, 0), v2(d.x * 80, d.y * 80), 0.25)).toBe(true);
  // a long horizontal edge one ½px grid-step off does NOT fire (perpendicular dev = ½px > ¼px)
  expect(alignedToAxis(v2(0, 0), v2(80, 0.5), 0.25)).toBe(false);
  // clearly off-axis edges stay dim
  for (const d of [v2(50, 20), v2(20, 50), v2(30, 10)]) expect(alignedToAxis(v2(0, 0), d, 0.25)).toBe(false);
});

test("vertex canvas position snaps to ½px even on a scaled shape (the 0.5-not-1.0 fix)", () => {
  const s = createShapeInstance("plateau", v2(10, 10)); // pos on grid, no rotation
  s.transform.scale = new Vector3(2, 2, 1);
  s.controlPoints = [v2(3.1, 3.1)]; // canvas = 10 + 3.1*2 = 16.2
  const world = fromLocal(snapShapeToGrid(s).transform, snapShapeToGrid(s).controlPoints[0]!);
  expect(world.x).toBe(16); // 16.2 -> 16.0 (nearest ½), not a 1px step from the 2× scale
  expect(world.y).toBe(16);
});
