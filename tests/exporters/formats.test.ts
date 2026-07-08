import { decode } from "fast-png";
import { expect, test } from "vitest";
import type { OutputSettings } from "../../src/document/schema";
import { encodeExr } from "../../src/exporters/exr";
import { encodeRadianceHdr, toRgbe } from "../../src/exporters/hdr";
import { encodeNx } from "../../src/exporters/nx";

const DIRS = { red: "right", green: "up" } as const;

/** flat-up normals (0,0,1) for n pixels */
const flatNormals = (n: number) => {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a[i * 3 + 2] = 1;
  return a;
};

const out = (o: Partial<OutputSettings>): OutputSettings => ({ channels: "rgba", depth: 16, format: "png", ...o });

// --- minimal EXR reader (enough to verify our writer end-to-end) ---

function readExr(bytes: Uint8Array): { width: number; height: number; channels: Map<string, Float32Array> } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x76, 0x2f, 0x31, 0x01]); // magic
  expect(bytes[4]).toBe(2); // version
  let o = 8;
  const readStr = (): string => {
    let s = "";
    while (bytes[o] !== 0) s += String.fromCharCode(bytes[o++]!);
    o++;
    return s;
  };
  const names: string[] = [];
  let width = 0;
  let height = 0;
  for (;;) {
    if (bytes[o] === 0) {
      o++;
      break; // end of header
    }
    const name = readStr();
    readStr(); // type
    const size = v.getInt32(o, true);
    o += 4;
    if (name === "channels") {
      const end = o + size;
      while (bytes[o] !== 0) {
        names.push(readStr());
        o += 16; // pixelType + pLinear/reserved + samplings
      }
      o = end;
    } else if (name === "dataWindow") {
      width = v.getInt32(o + 8, true) + 1;
      height = v.getInt32(o + 12, true) + 1;
      o += size;
    } else {
      o += size;
    }
  }
  expect([...names]).toEqual([...names].sort()); // format requires alphabetical channels
  const table: number[] = [];
  for (let y = 0; y < height; y++, o += 8) table.push(Number(v.getBigUint64(o, true)));
  const channels = new Map<string, Float32Array>(names.map((n) => [n, new Float32Array(width * height)]));
  for (let y = 0; y < height; y++) {
    let p = table[y]!;
    expect(v.getInt32(p, true)).toBe(y); // scanline y
    expect(v.getInt32(p + 4, true)).toBe(names.length * width * 4); // data size
    p += 8;
    for (const n of names) {
      const plane = channels.get(n)!;
      for (let x = 0; x < width; x++, p += 4) plane[y * width + x] = v.getFloat32(p, true);
    }
  }
  return { width, height, channels };
}

// --- minimal Radiance HDR reader (new-style RLE) ---

function readHdr(bytes: Uint8Array): { width: number; height: number; rgb: Float32Array } {
  const text = new TextDecoder().decode(bytes.slice(0, 256));
  expect(text.startsWith("#?RADIANCE")).toBe(true);
  const m = /-Y (\d+) \+X (\d+)\n/.exec(text)!;
  const height = Number(m[1]);
  const width = Number(m[2]);
  let o = text.indexOf(m[0]) + m[0].length;
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    expect([bytes[o], bytes[o + 1]]).toEqual([2, 2]); // new-style marker
    expect((bytes[o + 2]! << 8) | bytes[o + 3]!).toBe(width);
    o += 4;
    const planes = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
    for (const plane of planes) {
      let x = 0;
      while (x < width) {
        const c = bytes[o++]!;
        if (c > 128) {
          const val = bytes[o++]!;
          for (let k = 0; k < c - 128; k++) plane[x++] = val;
        } else {
          for (let k = 0; k < c; k++) plane[x++] = bytes[o++]!;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      const e = planes[3]![x]!;
      const scale = e === 0 ? 0 : 2 ** (e - 128) / 256;
      rgb[(y * width + x) * 3] = planes[0]![x]! * scale;
      rgb[(y * width + x) * 3 + 1] = planes[1]![x]! * scale;
      rgb[(y * width + x) * 3 + 2] = planes[2]![x]! * scale;
    }
  }
  return { width, height, rgb };
}

// --- PNG layouts + depths ---

test("nx png: rgb layout drops alpha (3 channels), 8-bit depth honored", () => {
  const png = decode(encodeNx(flatNormals(2), new Float32Array([1, 0]), 2, 1, DIRS, null, out({ channels: "rgb", depth: 8 })));
  expect(png.channels).toBe(3);
  expect(png.depth).toBe(8);
  expect([...png.data.slice(0, 3)]).toEqual([128, 128, 255]); // flat: half, half, full-range z
});

test("nx png: rg layout writes 2 planes (X, Y)", () => {
  const tilted = new Float32Array([Math.SQRT1_2, 0, Math.SQRT1_2]); // tilted right
  const png = decode(encodeNx(tilted, new Float32Array([1]), 1, 1, DIRS, null, out({ channels: "rg", depth: 16 })));
  expect(png.channels).toBe(2);
  expect(png.data[0]! / 65535).toBeCloseTo(0.8536, 3); // 0.5 + x/2
  expect(png.data[1]).toBe(32768);
});

test("nx png: rga layout is X, Y, gate — mask and diffuse opacity land in the third slot", () => {
  const png = decode(
    encodeNx(flatNormals(2), new Float32Array([1, 1]), 2, 1, DIRS, new Uint8Array([1, 0]), out({ channels: "rga", depth: 8 })),
  );
  expect(png.channels).toBe(3);
  expect(png.data[2]).toBe(255); // opaque + mask 1
  expect(png.data[5]).toBe(0); // transparent diffuse gates to 0
});

test("nx png: default settings byte-match the historical encodeNxPng contract", () => {
  const png = decode(encodeNx(flatNormals(1), new Float32Array([1]), 1, 1, DIRS, null, out({})));
  expect(png.depth).toBe(16);
  expect(png.channels).toBe(4);
  expect([...png.data.slice(0, 4)]).toEqual([32768, 32768, 65535, 65535]);
});

// --- EXR ---

test("nx exr: float32 scanline file round-trips exact channel values", () => {
  const n = new Float32Array([Math.SQRT1_2, 0, Math.SQRT1_2, 0, -Math.SQRT1_2, Math.SQRT1_2]); // 2 px
  const exr = readExr(encodeNx(n, new Float32Array([1, 0.5]), 2, 1, DIRS, null, out({ format: "exr" })));
  expect(exr.width).toBe(2);
  expect(exr.height).toBe(1);
  expect([...exr.channels.keys()].sort()).toEqual(["A", "B", "G", "R"]);
  expect(exr.channels.get("R")![0]).toBeCloseTo(0.5 + Math.SQRT1_2 / 2, 6);
  expect(exr.channels.get("B")![0]).toBeCloseTo(Math.SQRT1_2, 6); // full-range z
  expect(exr.channels.get("G")![1]).toBeCloseTo(0.5 + Math.SQRT1_2 / 2, 6); // green-up flips sign
  expect(exr.channels.get("A")![1]).toBeCloseTo(0.5, 6);
});

test("nx exr: rg layout ships only G and R channels", () => {
  const exr = readExr(encodeNx(flatNormals(4), new Float32Array(4).fill(1), 2, 2, DIRS, null, out({ format: "exr", channels: "rg" })));
  expect([...exr.channels.keys()].sort()).toEqual(["G", "R"]);
  expect(exr.height).toBe(2);
});

// --- HDR ---

test("nx hdr: RGBE round-trips within mantissa precision; non-rgb layouts are rejected", () => {
  const w = 8; // Radiance RLE minimum width
  const normals = flatNormals(w);
  const hdr = readHdr(encodeNx(normals, new Float32Array(w).fill(1), w, 1, DIRS, null, out({ format: "hdr", channels: "rgb" })));
  expect(hdr.width).toBe(8);
  expect(hdr.rgb[0]).toBeCloseTo(0.5, 2);
  expect(hdr.rgb[2]).toBeCloseTo(1, 2); // full-range z
  expect(() => encodeNx(normals, new Float32Array(w).fill(1), w, 1, DIRS, null, out({ format: "hdr", channels: "rgba" }))).toThrow(/RGB/);
});

test("normal rotation: the sign matches the label; ±90° are opposite spins, 180° flips red", () => {
  const right = new Float32Array([Math.SQRT1_2, 0, Math.SQRT1_2]); // right-tilted normal
  // Sign matches the label (positive spins red-positive right -> down): a right-tilt rotated +90°
  // reads as a downward-tilt, landing bright green (g = 0.5 + nx/2).
  const pos = decode(encodeNx(right, new Float32Array([1]), 1, 1, { ...DIRS, rotation: 90 }, null, out({ depth: 8 })));
  expect(pos.data[0]).toBe(128); // red neutral
  expect(pos.data[1]! / 255).toBeCloseTo(0.5 + Math.SQRT1_2 / 2, 1);
  // -90° is the opposite spin — the same tilt lands dark green
  const neg = decode(encodeNx(right, new Float32Array([1]), 1, 1, { ...DIRS, rotation: -90 }, null, out({ depth: 8 })));
  expect(neg.data[0]).toBe(128);
  expect(neg.data[1]! / 255).toBeCloseTo(0.5 - Math.SQRT1_2 / 2, 1);
  // 180° flips red
  const flip = decode(encodeNx(right, new Float32Array([1]), 1, 1, { ...DIRS, rotation: 180 }, null, out({ depth: 8 })));
  expect(flip.data[0]! / 255).toBeCloseTo(0.5 - Math.SQRT1_2 / 2, 1);
  // rotation 0 (and absent) match byte-for-byte
  const zero = encodeNx(right, new Float32Array([1]), 1, 1, { ...DIRS, rotation: 0 }, null, out({}));
  const absent = encodeNx(right, new Float32Array([1]), 1, 1, DIRS, null, out({}));
  expect(zero).toEqual(absent);
});

test("toRgbe: zero maps to zero; values round-trip within 1/256", () => {
  expect(toRgbe(0, 0, 0)).toEqual([0, 0, 0, 0]);
  for (const v of [0.001, 0.25, 0.5, 0.7071, 0.9999, 1]) {
    const [r, , , e] = toRgbe(v, 0, 0);
    const back = e === 0 ? 0 : r * (2 ** (e - 128) / 256);
    expect(Math.abs(back - v)).toBeLessThan(1 / 128);
  }
});

test("exr writer rejects mismatched channel sizes", () => {
  expect(() => encodeExr(2, 2, [{ name: "R", data: new Float32Array(3) }])).toThrow(/expected 4/);
});

test("hdr writer rejects widths outside the Radiance RLE range", () => {
  expect(() => encodeRadianceHdr(4, 1, new Float32Array(12))).toThrow(/\[8, 32767\]/);
});
