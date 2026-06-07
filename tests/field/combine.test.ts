import { expect, test } from "vitest";
import { combineHeight, influence } from "../../src/field/combine";

test("combineHeight ops", () => {
  expect(combineHeight("max", 0, 10)).toBe(10);
  expect(combineHeight("max", 24, 10)).toBe(24); // clip: no stacking
  expect(combineHeight("carve", 10, 4)).toBe(6);
  expect(combineHeight("carve", 10, -2)).toBe(10); // negative cut never raises
});

test("influence: 1 inside, smoothstep over 1px outside, 0 beyond", () => {
  expect(influence(-5)).toBe(1);
  expect(influence(0)).toBe(1);
  expect(influence(0.5)).toBeCloseTo(0.5);
  expect(influence(1)).toBe(0);
  expect(influence(3)).toBe(0);
});
