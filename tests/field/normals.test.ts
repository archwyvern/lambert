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

test("a trim/silhouette cliff does not flatten a tilted surface at its edge (mask fringe)", () => {
  // A constant x-ramp (dH/dx = 1) carved to 0 from x=4 on (a mask trim / footprint edge). The last
  // surface column (x=3) must still read the ramp's slope: the cliff side is maximally non-smooth,
  // so the smoothness-guided gradient takes the surface side instead of minmod cancelling to flat.
  const w = 8, h = 3;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) height[y * w + x] = x <= 3 ? x : 0;
  const n = deriveNormals(height, w, h);
  const i = (1 * w + 3) * 3; // last surface column, middle row
  expect(n[i]).toBeCloseTo(-Math.SQRT1_2, 2); // -dx/|.| with dx=1
  expect(n[i + 2]).toBeCloseTo(Math.SQRT1_2, 2);
});

test("a genuine flat-topped wall still reads flat at its edge", () => {
  // flat plateau (height 5) then a cliff to 0 — the edge must stay flat (the surface side is
  // flat), i.e. discontinuity handling must not turn walls into slopes.
  const w = 8, h = 3;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) height[y * w + x] = x <= 3 ? 5 : 0;
  const n = deriveNormals(height, w, h);
  const i = (1 * w + 3) * 3;
  expect(n[i]).toBeCloseTo(0, 5);
  expect(n[i + 2]).toBeCloseTo(1, 5);
});

test("a small step in a continuous slope leaves NO flat seam (intersecting plates)", () => {
  // ramp dH/dx = 0.5 with a 1.5px step DOWN at x=5: the step-crossing one-sided diff is
  // opposite-signed, so plain minmod zeroed BOTH adjacent columns — the 2px purple seam between
  // two intersecting plates. Both columns must keep the true ramp slope.
  const w = 12, h = 3;
  const s = 0.5, d = 1.5;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) height[y * w + x] = s * x - (x >= 5 ? d : 0);
  const n = deriveNormals(height, w, h);
  const expectNx = -s / Math.hypot(s, 1);
  for (const x of [3, 4, 5, 6, 8]) {
    const i = (1 * w + x) * 3;
    expect(n[i]).toBeCloseTo(expectNx, 2); // no flat column on either side of the step
  }
});

test("a tent apex still reads flat (both sides equally smooth -> minmod)", () => {
  const w = 11, h = 3;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) height[y * w + x] = 5 - Math.abs(x - 5);
  const n = deriveNormals(height, w, h);
  const i = (1 * w + 5) * 3; // the apex
  expect(n[i]).toBeCloseTo(0, 5);
  expect(n[i + 2]).toBeCloseTo(1, 5);
});
