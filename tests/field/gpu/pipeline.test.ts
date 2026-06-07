import { expect, test } from "vitest";
import { deinterleaveField, deinterleaveNormals, padRowBytes } from "../../../src/field/gpu/pipeline";

test("padRowBytes rounds bytesPerRow up to 256", () => {
  expect(padRowBytes(96 * 8)).toBe(768); // rg32float 96px = 768 bytes, already aligned
  expect(padRowBytes(100 * 8)).toBe(1024);
  expect(padRowBytes(1)).toBe(256);
});

test("deinterleaveField strips row padding and splits rg", () => {
  // 2x2 texture, rg32float, padded to 256 bytes/row
  const rowFloats = 256 / 4;
  const raw = new Float32Array(rowFloats * 2);
  // row 0: (h=1,m=0.5), (h=2,m=1)   row 1: (h=3,m=0), (h=4,m=0.25)
  raw.set([1, 0.5, 2, 1], 0);
  raw.set([3, 0, 4, 0.25], rowFloats);
  const { heightMap, mask } = deinterleaveField(raw, 2, 2, 256);
  expect([...heightMap]).toEqual([1, 2, 3, 4]);
  expect([...mask]).toEqual([0.5, 1, 0, 0.25]);
});

test("deinterleaveNormals strips padding and drops w into mask", () => {
  const rowFloats = 256 / 4;
  const raw = new Float32Array(rowFloats * 1);
  raw.set([0, 0, 1, 0.75, 0.5, 0, 0.5, 1], 0); // two rgba pixels
  const { normals, mask } = deinterleaveNormals(raw, 2, 1, 256);
  expect([...normals]).toEqual([0, 0, 1, 0.5, 0, 0.5]);
  expect([...mask]).toEqual([0.75, 1]);
});
