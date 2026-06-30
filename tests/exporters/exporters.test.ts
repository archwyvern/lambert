import { decode } from "fast-png";
import { expect, test } from "vitest";
import { encodeHeightmapPng } from "../../src/exporters/heightmap";
import { encodeNormalPng } from "../../src/exporters/normalmap";
import { diffuseOpacity, encodeNxPng } from "../../src/exporters/nx";

const flatNormals = (n: number) => {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a[i * 3 + 2] = 1;
  return a;
};

test("heightmap: 16-bit gray, min->0 max->65535", () => {
  const png = decode(
    encodeHeightmapPng({
      width: 2,
      height: 1,
      heightMap: new Float32Array([0, 24]),
      mask: new Float32Array([1, 1]),
    }),
  );
  expect(png.depth).toBe(16);
  expect(png.channels).toBe(1);
  expect(png.data[0]).toBe(0);
  expect(png.data[1]).toBe(65535);
});

const DIRS_UP = { red: "right", green: "up" } as const;
const DIRS_DOWN = { red: "right", green: "down" } as const;

test("normal map: flat normal encodes (128,128,255), generic half-range blue", () => {
  const png = decode(encodeNormalPng(flatNormals(1), 1, 1, DIRS_UP));
  expect([...png.data.slice(0, 4)]).toEqual([128, 128, 255, 255]);
});

test("normal map: green direction setting flips the channel", () => {
  const n = new Float32Array([0, Math.SQRT1_2, Math.SQRT1_2]); // tilted down-screen
  const up = decode(encodeNormalPng(n, 1, 1, DIRS_UP));
  const down = decode(encodeNormalPng(n, 1, 1, DIRS_DOWN));
  expect(up.data[1]!).toBeLessThan(128); // green-up: down-screen tilt = dark green
  expect(down.data[1]!).toBeGreaterThan(128);
  expect(up.data[1]! + down.data[1]!).toBe(255); // mirrored around 0.5
});

test("normal map: red direction setting flips the channel", () => {
  const n = new Float32Array([Math.SQRT1_2, 0, Math.SQRT1_2]); // tilted right
  const right = decode(encodeNormalPng(n, 1, 1, DIRS_UP));
  const left = decode(encodeNormalPng(n, 1, 1, { red: "left", green: "up" }));
  expect(right.data[0]!).toBeGreaterThan(128);
  expect(left.data[0]!).toBeLessThan(128);
});

test("nx: 16-bit, default red-right green-up, full-range blue, mask alpha", () => {
  const flat = decode(encodeNxPng(flatNormals(2), new Float32Array([1, 0]), 2, 1, DIRS_UP));
  expect(flat.depth).toBe(16);
  expect([...flat.data.slice(0, 4)]).toEqual([32768, 32768, 65535, 65535]);
  expect(flat.data[7]).toBe(0); // second pixel: mask 0 -> alpha 0
  // x-ramp normal (-sqrt2/2, 0, sqrt2/2): r ~ 0.1464, b ~ 0.7071 of full range
  const tilted = new Float32Array([-Math.SQRT1_2, 0, Math.SQRT1_2]);
  const px = decode(encodeNxPng(tilted, new Float32Array([1]), 1, 1, DIRS_UP));
  expect(px.data[0]! / 65535).toBeCloseTo(0.1464, 3);
  expect(px.data[1]).toBe(32768);
  expect(px.data[2]! / 65535).toBeCloseTo(0.7071, 3);
  // up-screen tilt (n.y < 0) brightens green under green-up
  const upTilt = new Float32Array([0, -Math.SQRT1_2, Math.SQRT1_2]);
  const gy = decode(encodeNxPng(upTilt, new Float32Array([1]), 1, 1, DIRS_UP));
  expect(gy.data[1]!).toBeGreaterThan(32768);
});

test("nx: diffuse opacity gates the mask alpha (transparent diffuse pixels -> 0)", () => {
  const opaque = new Uint8Array([1, 0]); // pixel 0 visible, pixel 1 transparent
  const px = decode(encodeNxPng(flatNormals(2), new Float32Array([1, 1]), 2, 1, DIRS_UP, opaque));
  expect(px.data[3]).toBe(65535); // opaque + mask 1 -> full
  expect(px.data[7]).toBe(0); // transparent -> alpha 0 despite mask 1
});

test("diffuseOpacity: flags A>0 per pixel, null when there's no alpha channel", () => {
  const rgba = { width: 2, height: 1, channels: 4, data: [0, 0, 0, 255, 0, 0, 0, 0] };
  expect(diffuseOpacity(rgba)).toEqual(new Uint8Array([1, 0]));
  expect(diffuseOpacity({ width: 1, height: 1, channels: 3, data: [10, 20, 30] })).toBeNull();
});
