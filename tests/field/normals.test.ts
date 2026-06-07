import { expect, test } from "vitest";
import { deriveNormals } from "../../src/field/normals";

test("flat field yields (0,0,1)", () => {
  const n = deriveNormals(new Float32Array(16).fill(5), 4, 4);
  expect(n[0]).toBeCloseTo(0);
  expect(n[1]).toBeCloseTo(0);
  expect(n[2]).toBeCloseTo(1);
});

test("x-ramp: dH/dx = 1 tilts the normal to (-1,0,1)/sqrt(2)", () => {
  const w = 8;
  const h = 4;
  const field = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) field[y * w + x] = x;
  const n = deriveNormals(field, w, h);
  const i = (2 * w + 4) * 3; // interior pixel
  const s = Math.SQRT1_2;
  expect(n[i]).toBeCloseTo(-s);
  expect(n[i + 1]).toBeCloseTo(0);
  expect(n[i + 2]).toBeCloseTo(s);
});

test("y-ramp (rising down-screen): normal tilts toward -y (up-screen faces)", () => {
  const w = 4;
  const h = 8;
  const field = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) field[y * w + x] = y;
  const n = deriveNormals(field, w, h);
  const i = (4 * w + 2) * 3;
  expect(n[i + 1]).toBeCloseTo(-Math.SQRT1_2);
});

test("normals are unit length everywhere including clamped edges", () => {
  const w = 5;
  const h = 5;
  const field = new Float32Array(w * h).map(() => Math.random() * 10);
  const n = deriveNormals(field, w, h);
  for (let i = 0; i < w * h; i++) {
    const l = Math.hypot(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!);
    expect(l).toBeCloseTo(1);
  }
});
