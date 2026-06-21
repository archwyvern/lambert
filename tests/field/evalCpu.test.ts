import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import { evaluateField } from "../../src/field/evalCpu";
import { resolveShapes } from "../../src/field/flatten";
import { v2 } from "../../src/field/vec";
import { Vector3 } from "@carapace/primitives";

const px = (r: { width: number }, x: number, y: number) => y * r.width + x;

test("single dome: height at center, zero + unmasked far away", () => {
  const dome = createShapeInstance("dome", v2(64, 64));
  const r = evaluateField(resolveShapes([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeGreaterThan(23.9);
  expect(r.mask[px(r, 64, 64)]!).toBe(1);
  expect(r.heightMap[px(r, 4, 4)]!).toBe(0);
  expect(r.mask[px(r, 4, 4)]!).toBe(0);
});

test("invisible shapes are skipped", () => {
  const dome = createShapeInstance("dome", v2(64, 64));
  dome.visible = false;
  const r = evaluateField(resolveShapes([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBe(0);
  expect(r.mask[px(r, 64, 64)]!).toBe(0);
});

test("max: overlapping shapes merge to the taller", () => {
  const low = createShapeInstance("plateau", v2(64, 64));
  const tall = createShapeInstance("plateau", v2(80, 64));
  tall.transform.scale = tall.transform.scale.withZ(40 / 24); // extrude to 40px
  const r = evaluateField(resolveShapes([low, tall]), 160, 128);
  expect(r.heightMap[px(r, 80, 64)]!).toBeCloseTo(40, 0); // overlap: taller wins
});

test("shapes clip: overlapping shapes do not stack heights", () => {
  const slab = createShapeInstance("plateau", v2(64, 64));
  const stud = createShapeInstance("dome", v2(64, 64));
  stud.transform.scale = new Vector3(8 / 48, 8 / 48, 10 / 48); // 8px stud, 10px tall
  const r = evaluateField(resolveShapes([slab, stud]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(24, 0); // max(24, ~10), not 34
});

test("carve cuts into what is below", () => {
  const slab = createShapeInstance("plateau", v2(64, 64));
  const cut = createShapeInstance("groove", v2(64, 64));
  const r = evaluateField(resolveShapes([slab, cut]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(24 - 8, 1);
  expect(r.mask[px(r, 64, 64)]!).toBe(1); // carve still authors the mask
});

test("pos.z is base elevation: lifts the shape, does not scale with extrude", () => {
  const dome = createShapeInstance("dome", v2(64, 64));
  dome.transform.pos = dome.transform.pos.withZ(10);
  dome.transform.scale = dome.transform.scale.withZ(0.5);
  const r = evaluateField(resolveShapes([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(10 + 24, 1); // elevation + 48*0.5
  expect(r.heightMap[px(r, 64 + 47, 64)]!).toBeGreaterThan(9.9); // near the rim: cliff at elevation
});

test("negative elevation sinks below the ground (negative Z allowed) and is masked", () => {
  const dome = createShapeInstance("dome", v2(64, 64));
  dome.transform.pos = dome.transform.pos.withZ(-60); // peak 48 - 60 = -12 at centre: fully below ground
  const r = evaluateField(resolveShapes([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(-12, 0); // sinks below the floor, no longer clipped to 0
  expect(r.mask[px(r, 64, 64)]!).toBe(1); // it changed the surface, so it IS masked
  expect(r.heightMap[px(r, 64 + 60, 64)]!).toBe(0); // outside the footprint: untouched ground
  dome.transform.pos = dome.transform.pos.withZ(-24); // half-buried: cap pokes out at center
  const r2 = evaluateField(resolveShapes([dome]), 128, 128);
  expect(r2.heightMap[px(r2, 64, 64)]!).toBeCloseTo(24, 1);
  expect(r2.mask[px(r2, 64, 64)]!).toBe(1);
});

test("scale.z scales the contribution (tallness)", () => {
  const dome = createShapeInstance("dome", v2(64, 64));
  dome.transform.scale = dome.transform.scale.withZ(0.5);
  const r = evaluateField(resolveShapes([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(24, 1);
});

test("transform: offset position and 2x scale", () => {
  const dome = createShapeInstance("dome", v2(32, 32));
  dome.transform.scale = new Vector3(2, 2, 1);
  const r = evaluateField(resolveShapes([dome]), 256, 256);
  // local rim at 48 -> canvas rim at 96 from center
  expect(r.heightMap[px(r, 32, 32)]!).toBeGreaterThan(23.9);
  expect(r.heightMap[px(r, 32 + 90, 32)]!).toBeGreaterThan(0);
  expect(r.heightMap[px(r, 32 + 100, 32)]!).toBe(0);
});


test("unknown typeId throws", () => {
  const ghost = { ...createShapeInstance("dome", v2(0, 0)), typeId: "ghost" };
  expect(() => evaluateField(resolveShapes([ghost]), 8, 8)).toThrow(/unknown shape type/);
});
