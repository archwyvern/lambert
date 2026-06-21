import { describe, expect, it } from "vitest";
import { Canvas } from "../../../src/field/skyrat/normalmap";

// Ports skyrat-processing/internal/normalmap/normalmap_test.go — the same fixtures + golden values,
// so this port is pinned to the Go/C# reference rather than eyeballed.

const N = (n: Float32Array, i: number): [number, number, number] => [n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!];

function makeCircle(w: number, h: number, r: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * w + x) * 4;
        data[i] = 200;
        data[i + 1] = 200;
        data[i + 2] = 200;
        data[i + 3] = 255;
      }
    }
  }
  return data;
}

/** Fully-opaque canvas, all normals (0,0,1), manual visual center — mirrors the Go neutralCanvas. */
function neutralCanvas(w: number, h: number, vcx: number, vcy: number, furthest: number): Canvas {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  const c = Canvas.prepare(data, w, h, 0.8);
  for (let i = 0; i < w * h; i++) {
    c.normals[i * 3] = 0;
    c.normals[i * 3 + 1] = 0;
    c.normals[i * 3 + 2] = 1;
  }
  // override the computed visual center with the test's exact one
  (c as unknown as { vcx: number; vcy: number; furthest: number }).vcx = vcx;
  (c as unknown as { vcx: number; vcy: number; furthest: number }).vcy = vcy;
  (c as unknown as { vcx: number; vcy: number; furthest: number }).furthest = furthest;
  return c;
}

const TOL = 1e-3;
const close = (got: [number, number, number], want: [number, number, number]): void => {
  for (let k = 0; k < 3; k++) expect(Math.abs(got[k]! - want[k]!)).toBeLessThan(TOL);
};

describe("skyrat normalmap port (pinned to the Go reference)", () => {
  it("default stages keep the center near neutral", () => {
    const c = Canvas.prepare(makeCircle(64, 64, 20), 64, 64, 0.8);
    c.bevel();
    c.bevelSmooth(0.5);
    c.radial();
    c.gradient(0.3, 0.75);
    const p = N(c.normals, 32 * 64 + 32);
    expect(Math.abs(p[0])).toBeLessThan(0.15);
    expect(Math.abs(p[1])).toBeLessThan(0.15);
    expect(p[2]).toBeGreaterThan(0.8);
  });

  it("bevel leaves transparent pixels at zero", () => {
    const c = Canvas.prepare(makeCircle(64, 64, 20), 64, 64, 0.8);
    c.bevel();
    for (let i = 0; i < 64 * 64; i++) {
      if (!c.opaque[i]) {
        const n = N(c.normals, i);
        expect(n).toEqual([0, 0, 0]);
      }
    }
  });

  it("empty image yields all-zero normals and never throws", () => {
    const c = Canvas.prepare(new Uint8Array(16 * 16 * 4), 16, 16, 0.8);
    c.bevel();
    c.radial();
    c.gradient(0.3, 0.75);
    for (let i = 0; i < 16 * 16; i++) expect(N(c.normals, i)).toEqual([0, 0, 0]);
  });

  it("radial adds the full vector incl. Z (flattens interior)", () => {
    const c = neutralCanvas(3, 3, 1.5, 1.5, 2);
    c.radial();
    close(N(c.normals, 1 * 3 + 0), [-0.5785884, -0.1928628, 0.7925211]);
    close(N(c.normals, 1 * 3 + 1), [-0.175103, -0.175103, 0.9688549]);
  });

  it("override replaces where mask > 0, leaves mask 0 untouched, never touches transparent pixels", () => {
    const c = neutralCanvas(2, 1, 1, 0.5, 0);
    c.normals.set([0.6, 0, 0.8], 0);
    c.normals.set([0.6, 0, 0.8], 3);
    // pixel 0 overridden to (-1, -0.0039216, 1); pixel 1 has mask 0 -> unchanged
    const nx = new Float32Array([-1, -0.0039216, 1, 0.123, 0.456, 0.789]);
    const mask = new Float32Array([1, 0]);
    c.override(nx, mask);
    close(N(c.normals, 0), [-1, -0.0039216, 1]);
    close(N(c.normals, 1), [0.6, 0, 0.8]);
  });

  it("radial changes the normals vs bevel+smooth alone (stages compose)", () => {
    const mk = (): Canvas => {
      const c = Canvas.prepare(makeCircle(64, 64, 20), 64, 64, 0.8);
      c.bevel();
      c.bevelSmooth(0.5);
      return c;
    };
    const a = mk();
    a.radial();
    const b = mk();
    let same = true;
    for (let i = 0; i < a.normals.length; i++) {
      if (a.normals[i] !== b.normals[i]) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });
});
