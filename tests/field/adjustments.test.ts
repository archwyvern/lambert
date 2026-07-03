import { expect, test } from "vitest";
import "../../src/field/objects";
import { applyAdjustments, createAdjustment } from "../../src/field/adjustments";
import { evaluateField } from "../../src/field/evalCpu";
import { resolveObjects } from "../../src/field/flatten";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

const region = () => createObjectInstance(ObjectTypeId.Adjust, v2(0, 0)); // 96px box region

test("kinds: add / multiply / clamp / curve transform H pointwise", () => {
  const r = region();
  const at = v2(0, 0);
  const one = (kind: string, params: Record<string, number>, H: number): number => {
    const a = { ...createAdjustment(kind), params: { ...createAdjustment(kind).params, ...params } };
    return applyAdjustments(H, [a], at, r, 1);
  };
  expect(one("add", { amount: 5 }, 10)).toBe(15);
  expect(one("multiply", { factor: 2 }, 10)).toBe(20);
  expect(one("clamp", { min: 0, max: 8 }, 10)).toBe(8);
  // curve gamma 2 over [0, 24]: H=12 -> t=0.5 -> 24*0.25 = 6
  expect(one("curve", { low: 0, high: 24, gamma: 2 }, 12)).toBeCloseTo(6, 6);
});

test("strength lerps: out = mix(H, f(H), strength); hidden entries are skipped; order chains", () => {
  const r = region();
  const at = v2(0, 0);
  const add10 = { ...createAdjustment("add"), params: { amount: 10 } };
  expect(applyAdjustments(0, [{ ...add10, strength: 0.5 }], at, r, 1)).toBe(5);
  expect(applyAdjustments(0, [{ ...add10, visible: false }], at, r, 1)).toBe(0);
  // chained in order: (0 + 10) * 2 = 20, not (0 * 2) + 10
  const mul2 = { ...createAdjustment("multiply"), params: { factor: 2 } };
  expect(applyAdjustments(0, [add10, mul2], at, r, 1)).toBe(20);
  // coverage gates the whole blend
  expect(applyAdjustments(0, [add10], at, r, 0.25)).toBe(2.5);
});

test("ramp: 0 -> depth across the region along the angle, region-local", () => {
  const r = region(); // box ±48
  const ramp = { ...createAdjustment("ramp"), params: { angle: 0, depth: 12 } }; // along +x
  expect(applyAdjustments(0, [ramp], v2(-48, 0), r, 1)).toBeCloseTo(0, 4);
  expect(applyAdjustments(0, [ramp], v2(0, 0), r, 1)).toBeCloseTo(6, 4);
  expect(applyAdjustments(0, [ramp], v2(48, 0), r, 1)).toBeCloseTo(12, 4);
});

test("fold integration: an adjustment layer transforms the surface below, inside its region only", () => {
  // a flat 24-tall plateau across the canvas, then an Adjust layer (add +10, half-strength) over
  // the left half. Right half untouched; outside the plateau the ground stays 0 (no mask added).
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(32, 16));
  slab.controlPoints = [v2(-30, -14), v2(30, -14), v2(30, 14), v2(-30, 14), v2(-30, -14), v2(30, -14), v2(30, 14), v2(-30, 14)];
  slab.ringSplit = 4;
  const adj = region();
  adj.transform.pos = adj.transform.pos.withX(16).withY(16);
  adj.transform.scale = adj.transform.scale.withX(16 / 48).withY(16 / 48); // 32x32 region over the left
  adj.adjustments = [{ ...createAdjustment("add"), params: { amount: 10 }, strength: 0.5 }];
  const field = evaluateField(resolveObjects([slab, adj]), 64, 32);
  const at = (x: number, y: number): number => field.heightMap[y * 64 + x]!;
  expect(at(16, 16)).toBeCloseTo(29, 4); // 24 + 10*0.5 inside the region
  expect(at(48, 16)).toBeCloseTo(24, 4); // right half: untouched
  const mask = (x: number, y: number): number => field.mask[y * 64 + x]!;
  expect(mask(16, 0)).toBe(0); // region over bare ground adds NO mask
  expect(at(16, 0)).toBeCloseTo(5, 4); // but the ground height inside the region is raised (10*0.5)
});
