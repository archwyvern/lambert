import { expect, test } from "vitest";
import { combineHeight, influence } from "../../src/field/combine";

test("combineHeight ops", () => {
  expect(combineHeight("max", 0, 10)).toBe(10);
  expect(combineHeight("max", 24, 10)).toBe(24); // clip: no stacking
  expect(combineHeight("carve", 10, 4)).toBe(6);
  expect(combineHeight("carve", 10, -2)).toBe(10); // negative cut never raises
});

test("influence: box-filter coverage centered on the edge (no 1px bleed)", () => {
  expect(influence(-5)).toBe(1); // deep inside
  expect(influence(-0.5)).toBe(1); // a half-pixel inside = fully covered
  expect(influence(0)).toBeCloseTo(0.5); // exactly on the edge = half coverage
  expect(influence(0.5)).toBe(0); // a half-pixel outside = nothing
  expect(influence(3)).toBe(0);
});
