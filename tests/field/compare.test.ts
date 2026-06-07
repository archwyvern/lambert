import { expect, test } from "vitest";
import { compareRenders } from "../../src/field/compare";

const mk = (h: number[], m: number[], n: number[]) => ({
  width: h.length,
  height: 1,
  heightMap: new Float32Array(h),
  mask: new Float32Array(m),
  normals: new Float32Array(n),
});

test("identical renders pass with zero diffs", () => {
  const a = mk([1, 2], [1, 0], [0, 0, 1, 0, 0, 1]);
  const r = compareRenders(a, mk([1, 2], [1, 0], [0, 0, 1, 0, 0, 1]));
  expect(r.pass).toBe(true);
  expect(r.maxHeight).toBe(0);
  expect(r.maxNormal).toBe(0);
  expect(r.maxMask).toBe(0);
});

test("reports max abs diffs and fails over tolerance", () => {
  const a = mk([1, 2], [1, 0], [0, 0, 1, 0, 0, 1]);
  const b = mk([1, 2.1], [1, 0.001], [0, 0.0005, 1, 0, 0, 1]);
  const r = compareRenders(a, b);
  expect(r.maxHeight).toBeCloseTo(0.1);
  expect(r.maxMask).toBeCloseTo(0.001);
  expect(r.maxNormal).toBeCloseTo(0.0005);
  expect(r.pass).toBe(false); // height 0.1 > 5e-3
});

test("dimension mismatch throws", () => {
  const a = mk([1], [1], [0, 0, 1]);
  const b = mk([1, 2], [1, 0], [0, 0, 1, 0, 0, 1]);
  expect(() => compareRenders(a, b)).toThrow(/dimensions/);
});
