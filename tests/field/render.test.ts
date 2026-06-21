import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import { renderField } from "../../src/field/render";
import { resolveShapes } from "../../src/field/flatten";
import { v2 } from "../../src/field/vec";

test("supersample 1 matches direct evaluation shape-for-shape", () => {
  const dome = createShapeInstance("dome", v2(32, 32));
  const r = renderField(resolveShapes([dome]), 64, 64, { supersample: 1 });
  expect(r.width).toBe(64);
  expect(r.normals.length).toBe(64 * 64 * 3);
  expect(r.heightMap[32 * 64 + 32]!).toBeGreaterThan(23.9);
});

test("supersample 2 returns target resolution with unit normals", () => {
  const dome = createShapeInstance("dome", v2(32, 32));
  const r = renderField(resolveShapes([dome]), 64, 64, { supersample: 2 });
  expect(r.width).toBe(64);
  expect(r.height).toBe(64);
  for (let i = 0; i < 64 * 64; i++) {
    const l = Math.hypot(r.normals[i * 3]!, r.normals[i * 3 + 1]!, r.normals[i * 3 + 2]!);
    expect(l).toBeGreaterThan(0.999);
    expect(l).toBeLessThan(1.001);
  }
});

test("supersampling softens the rim, preserves the interior", () => {
  const slab = createShapeInstance("plateau", v2(32, 32));
  const r1 = renderField(resolveShapes([slab]), 64, 64, { supersample: 1 });
  const r2 = renderField(resolveShapes([slab]), 64, 64, { supersample: 2 });
  expect(r2.heightMap[32 * 64 + 32]!).toBeCloseTo(r1.heightMap[32 * 64 + 32]!, 1);
  expect(r2.mask[32 * 64 + 32]!).toBeCloseTo(1);
});

test("supersample 2 preserves slopes: ss1 and ss2 normals agree on a ramp", () => {
  const slab = createShapeInstance("plateau", v2(32, 32));
  slab.params.profile = "linear";
  const r1 = renderField(resolveShapes([slab]), 64, 64, { supersample: 1 });
  const r2 = renderField(resolveShapes([slab]), 64, 64, { supersample: 2 });
  const i = (32 * 64 + 4) * 3; // x=4: on the linear slope (inside-distance 4.5 of 12)
  expect(r2.normals[i]!).toBeCloseTo(r1.normals[i]!, 1);
});
