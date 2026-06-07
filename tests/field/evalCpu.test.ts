import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import { evaluateField } from "../../src/field/evalCpu";
import { v2 } from "../../src/field/vec";

const px = (r: { width: number }, x: number, y: number) => y * r.width + x;

test("single dome: height at center, zero + unmasked far away", () => {
  const dome = createShapeInstance("dome", v2(64, 64));
  const r = evaluateField([dome], 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeGreaterThan(23.9);
  expect(r.mask[px(r, 64, 64)]!).toBe(1);
  expect(r.heightMap[px(r, 4, 4)]!).toBe(0);
  expect(r.mask[px(r, 4, 4)]!).toBe(0);
});

test("invisible shapes are skipped", () => {
  const dome = createShapeInstance("dome", v2(64, 64));
  dome.visible = false;
  const r = evaluateField([dome], 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBe(0);
  expect(r.mask[px(r, 64, 64)]!).toBe(0);
});

test("raise: overlapping shapes merge to the taller", () => {
  const low = createShapeInstance("plateau", v2(64, 64));
  const tall = createShapeInstance("plateau", v2(80, 64));
  tall.params.height = 40;
  const r = evaluateField([low, tall], 160, 128);
  expect(r.heightMap[px(r, 80, 64)]!).toBeCloseTo(40, 0); // overlap: taller wins
});

test("add follows underlying curvature", () => {
  const base = createShapeInstance("dome", v2(64, 64));
  const stud = createShapeInstance("dome", v2(64, 64));
  stud.params = { ...stud.params, radiusX: 8, radiusY: 8, height: 4 };
  stud.combine = { op: "add", blend: 0 };
  const r = evaluateField([base, stud], 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeGreaterThan(27.9); // 24 + 4 minus pixel-center epsilon
});

test("carve cuts into what is below", () => {
  const slab = createShapeInstance("plateau", v2(64, 64));
  const cut = createShapeInstance("groove", v2(64, 64));
  const r = evaluateField([slab, cut], 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(24 - 8, 1);
  expect(r.mask[px(r, 64, 64)]!).toBe(1); // carve still authors the mask
});

test("strength scales the contribution", () => {
  const dome = createShapeInstance("dome", v2(64, 64));
  dome.strength = 0.5;
  const r = evaluateField([dome], 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(12, 1);
});

test("transform: offset position and 2x scale", () => {
  const dome = createShapeInstance("dome", v2(32, 32));
  dome.transform.scale = v2(2, 2);
  const r = evaluateField([dome], 256, 256);
  // local rim at 48 -> canvas rim at 96 from center
  expect(r.heightMap[px(r, 32, 32)]!).toBeGreaterThan(23.9);
  expect(r.heightMap[px(r, 32 + 90, 32)]!).toBeGreaterThan(0);
  expect(r.heightMap[px(r, 32 + 100, 32)]!).toBe(0);
});

test("blend bulges where equal-height shapes overlap (weld fillet)", () => {
  const a = createShapeInstance("plateau", v2(50, 64));
  const b = createShapeInstance("plateau", v2(70, 64));
  b.combine = { op: "raise", blend: 8 };
  const r = evaluateField([a, b], 128, 128);
  // overlap interior: both at full height 24, smax bulge = k/4 = 2
  const overlap = r.heightMap[px(r, 60, 64)]!;
  expect(overlap).toBeGreaterThan(24);
  expect(overlap).toBeLessThanOrEqual(26.01);
  // a-only region outside b's influence stays untouched
  expect(r.heightMap[px(r, 30, 64)]!).toBeCloseTo(24, 1);
});

test("unknown typeId throws", () => {
  const ghost = { ...createShapeInstance("dome", v2(0, 0)), typeId: "ghost" };
  expect(() => evaluateField([ghost], 8, 8)).toThrow(/unknown shape type/);
});
