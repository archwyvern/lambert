import { expect, test } from "vitest";
import { v2 } from "../../src/field/vec";
import { distanceScale, toLocal } from "../../src/field/transform";

test("toLocal: translation and scale", () => {
  const t = { pos: { x: 10, y: 5, z: 0 }, rotation: 0, scale: { x: 2, y: 2, z: 1 } };
  const p = toLocal(t, v2(14, 5));
  expect(p.x).toBeCloseTo(2);
  expect(p.y).toBeCloseTo(0);
});

test("toLocal: rotation +90deg maps canvas-down to local +x", () => {
  const t = { pos: { x: 0, y: 0, z: 0 }, rotation: Math.PI / 2, scale: { x: 1, y: 1, z: 1 } };
  const p = toLocal(t, v2(0, 10));
  expect(p.x).toBeCloseTo(10);
  expect(p.y).toBeCloseTo(0);
});

test("distanceScale averages absolute axis scales", () => {
  expect(distanceScale({ pos: { x: 0, y: 0, z: 0 }, rotation: 0, scale: { x: 2, y: 4, z: 1 } })).toBeCloseTo(3);
  expect(distanceScale({ pos: { x: 0, y: 0, z: 0 }, rotation: 0, scale: { x: -2, y: 2, z: 1 } })).toBeCloseTo(2);
});
