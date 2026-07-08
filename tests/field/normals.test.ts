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

test("coverage-aware: a masked-out neighbour does not flatten a tilted surface at the edge", () => {
  // A constant x-ramp (dH/dx = 1) covered on the left half (mask 1) and trimmed on the right
  // (mask 0, height carved to 0). The last COVERED column's normal must still read the ramp's
  // slope, not get cancelled by the cliff into the carved region.
  const w = 8, h = 3;
  const height = new Float32Array(w * h);
  const mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const covered = x <= 3;
      height[y * w + x] = covered ? x : 0; // ramp where covered, carved to 0 outside
      mask[y * w + x] = covered ? 1 : 0;
    }
  }
  // WITHOUT coverage awareness the edge column (x=3) minmods the ramp (+1) against the cliff
  // (0-3=-3) -> 0 -> a flat (0,0,1) normal (the fringe). WITH it, x=3 uses its covered (left)
  // neighbour only -> slope 1 -> the true tilted normal.
  const n = deriveNormals(height, w, h, 1, mask);
  const i = (1 * w + 3) * 3; // last covered column, middle row
  expect(n[i]).toBeCloseTo(-Math.SQRT1_2, 2); // -dx/|.| with dx=1
  expect(n[i + 2]).toBeCloseTo(Math.SQRT1_2, 2);
});

test("coverage-aware: a genuine flat-topped wall still reads flat at its edge", () => {
  // flat plateau (height 5) covered on the left, carved to 0 on the right — the edge must stay
  // flat (the interior side is flat), i.e. the fix must not turn walls into slopes.
  const w = 8, h = 3;
  const height = new Float32Array(w * h);
  const mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const covered = x <= 3;
    height[y * w + x] = covered ? 5 : 0;
    mask[y * w + x] = covered ? 1 : 0;
  }
  const n = deriveNormals(height, w, h, 1, mask);
  const i = (1 * w + 3) * 3;
  expect(n[i]).toBeCloseTo(0, 5);
  expect(n[i + 2]).toBeCloseTo(1, 5);
});
