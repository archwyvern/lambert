import { decode } from "fast-png";
import { expect, test } from "vitest";
import { encodeHeightmapPng } from "../../src/exporters/heightmap";
import { encodeNormalPng } from "../../src/exporters/normalmap";
import { encodeNxPng, nxFileName } from "../../src/exporters/nx";

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

test("normal map: flat normal encodes (128,128,255), generic half-range blue", () => {
  const png = decode(encodeNormalPng(flatNormals(1), 1, 1, { yUp: true }));
  expect([...png.data.slice(0, 4)]).toEqual([128, 128, 255, 255]);
});

test("normal map: yUp flips green", () => {
  const n = new Float32Array([0, Math.SQRT1_2, Math.SQRT1_2]); // tilted down-screen
  const up = decode(encodeNormalPng(n, 1, 1, { yUp: true }));
  const down = decode(encodeNormalPng(n, 1, 1, { yUp: false }));
  expect(up.data[1]!).toBeLessThan(128); // y-up convention: down-screen tilt = dark green
  expect(down.data[1]!).toBeGreaterThan(128);
  expect(up.data[1]! + down.data[1]!).toBe(255); // mirrored around 0.5
});

test("nx: image-space green (no flip), full-range blue, mask alpha", () => {
  const flat = decode(encodeNxPng(flatNormals(2), new Float32Array([1, 0]), 2, 1));
  expect([...flat.data.slice(0, 4)]).toEqual([128, 128, 255, 255]);
  expect(flat.data[7]).toBe(0); // second pixel: mask 0 -> alpha 0
  // x-ramp normal (-sqrt2/2, 0, sqrt2/2): r = q8(0.1464) = 37, b = q8(0.7071) = 180
  const tilted = new Float32Array([-Math.SQRT1_2, 0, Math.SQRT1_2]);
  const px = decode(encodeNxPng(tilted, new Float32Array([1]), 1, 1));
  expect(px.data[0]).toBe(37);
  expect(px.data[1]).toBe(128);
  expect(px.data[2]).toBe(180);
});

test("nxFileName strips a .df tag and appends .nx", () => {
  expect(nxFileName("hull.df.png")).toBe("hull.nx.png");
  expect(nxFileName("hull.png")).toBe("hull.nx.png");
  expect(nxFileName("hull.foo.png")).toBe("hull.foo.nx.png");
  expect(() => nxFileName("hull.jpg")).toThrow(/png/);
});
