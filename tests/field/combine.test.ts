import { expect, test } from "vitest";
import { combineHeight, influence, smax, smin } from "../../src/field/combine";

test("smax/smin degrade to max/min at k=0", () => {
  expect(smax(3, 5, 0)).toBe(5);
  expect(smin(3, 5, 0)).toBe(3);
});

test("smax bulges by k/4 at equality (the fillet)", () => {
  expect(smax(0, 0, 4)).toBeCloseTo(1);
  expect(smax(10, 10, 4)).toBeCloseTo(11);
  // outside the k band it is plain max
  expect(smax(0, 10, 4)).toBeCloseTo(10);
});

test("combineHeight ops", () => {
  expect(combineHeight("max", 0, 10, 0)).toBe(10);
  expect(combineHeight("max", 24, 10, 0)).toBe(24); // clip: no stacking
  expect(combineHeight("carve", 10, 4, 0)).toBe(6);
});

test("influence: 1 inside, smooth falloff outside over max(blend, 1)", () => {
  expect(influence(-3, 0)).toBe(1);
  expect(influence(0, 10)).toBe(1);
  expect(influence(5, 10)).toBeCloseTo(0.5); // smoothstep(0.5) = 0.5
  expect(influence(10, 10)).toBe(0);
  // blend 0 still gets a 1px AA skirt
  expect(influence(0.5, 0)).toBeCloseTo(0.5);
  expect(influence(2, 0)).toBe(0);
});
