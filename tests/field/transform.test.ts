import { expect, test } from "vitest";
import { v2 } from "../../src/field/vec";
import { distanceScale, toLocal } from "../../src/field/transform";

test("toLocal: translation and scale", () => {
  const t = { pos: v2(10, 5), rotation: 0, scale: v2(2, 2) };
  const p = toLocal(t, v2(14, 5));
  expect(p.x).toBeCloseTo(2);
  expect(p.y).toBeCloseTo(0);
});

test("toLocal: rotation +90deg maps canvas-down to local +x", () => {
  const t = { pos: v2(0, 0), rotation: Math.PI / 2, scale: v2(1, 1) };
  const p = toLocal(t, v2(0, 10));
  expect(p.x).toBeCloseTo(10);
  expect(p.y).toBeCloseTo(0);
});

test("distanceScale averages absolute axis scales", () => {
  expect(distanceScale({ pos: v2(0, 0), rotation: 0, scale: v2(2, 4) })).toBeCloseTo(3);
  expect(distanceScale({ pos: v2(0, 0), rotation: 0, scale: v2(-2, 2) })).toBeCloseTo(2);
});
