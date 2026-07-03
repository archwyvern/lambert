import { encode } from "fast-png";
import { expect, test } from "vitest";
import "../../src/field/objects";
import { createAdjustment } from "../../src/field/adjustments";
import { computeDetailField, DETAIL_DEFAULTS, detailFieldForDiffuse, sampleDetail } from "../../src/field/detail";
import { evaluateField } from "../../src/field/evalCpu";
import { resolveObjects } from "../../src/field/flatten";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

/** A 48x48 rgba: bright 8px vertical stripe (0.9) on a dark field (0.2), plus optional faint
 *  per-pixel noise below the tolerance. */
function stripes(noise = 0): { data: Uint8Array; width: number; height: number; channels: number } {
  const w = 48;
  const h = 48;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bright = x >= 20 && x < 28;
      let v = bright ? 230 : 50;
      if (noise > 0) v += (Math.floor(x / 3) % 2 === 0 ? 1 : -1) * noise; // period-6 jitter stripes (below Nyquist, so the FC solve preserves them when ungated)
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h, channels: 4 };
}

test("skyrat chain: a bright feature integrates to RAISED height (bright = high)", () => {
  const field = computeDetailField(stripes(), { radius: 1, blur: 1, tolerance: 0.05 });
  const on = sampleDetail(field, 24.5, 24.5)[0]; // stripe centre
  const off = sampleDetail(field, 8.5, 24.5)[0]; // dark field
  expect(on).toBeGreaterThan(off + 1); // plateau raised well above the surround
  // symmetric about the stripe
  expect(sampleDetail(field, 16.5, 24.5)[0]).toBeCloseTo(sampleDetail(field, 31.5, 24.5)[0], 0);
});

test("tolerance gates noise: sub-tolerance jitter contributes ~nothing", () => {
  const clean = computeDetailField(stripes(0), { radius: 1, blur: 1, tolerance: 0.3 });
  const noisy = computeDetailField(stripes(12), { radius: 1, blur: 1, tolerance: 0.3 }); // 12/255 < 0.3
  const gated = computeDetailField(stripes(12), { radius: 1, blur: 1, tolerance: 0.01 }); // gate off
  const flat = (f: typeof clean): number => {
    // roughness of the dark field area = mean |h - rowmean|
    let sum = 0;
    let n = 0;
    for (let y = 20; y < 28; y++) for (let x = 2; x < 14; x++) { sum += Math.abs(f.data[(y * 48 + x) * 4]! - f.data[(y * 48 + 8) * 4]!); n++; }
    return sum / n;
  };
  expect(flat(noisy)).toBeLessThan(flat(gated) + 1e-6); // tolerance suppressed the jitter
  expect(Math.abs(flat(noisy) - flat(clean))).toBeLessThan(0.4); // ~as flat as the clean input
});

test("blur smooths the relief; radius broadens the response", () => {
  const sharp = computeDetailField(stripes(), { radius: 1, blur: 0, tolerance: 0.05 });
  const soft = computeDetailField(stripes(), { radius: 1, blur: 3, tolerance: 0.05 });
  // slope right at the stripe edge is gentler when blurred
  const slope = (f: typeof sharp): number => Math.abs(sampleDetail(f, 20.5, 24.5)[0] - sampleDetail(f, 18.5, 24.5)[0]);
  expect(slope(soft)).toBeLessThan(slope(sharp));
  const wide = computeDetailField(stripes(), { radius: 4, blur: 1, tolerance: 0.05 });
  // a larger radius responds further from the edge
  const far = (f: typeof sharp): number => Math.abs(sampleDetail(f, 17.5, 24.5)[0] - sampleDetail(f, 8.5, 24.5)[0]);
  expect(far(wide)).toBeGreaterThan(far(sharp));
});

test("detailFieldForDiffuse caches per byte buffer AND per chain params", () => {
  const bytes = new Uint8Array(encode({ width: 48, height: 48, data: stripes().data }));
  const a = detailFieldForDiffuse(bytes, DETAIL_DEFAULTS);
  expect(detailFieldForDiffuse(bytes, DETAIL_DEFAULTS)).toBe(a);
  expect(detailFieldForDiffuse(bytes, { radius: 2, blur: 1, tolerance: 0.3 })).not.toBe(a);
});

test("fold: the detail adjustment embosses via strength; negative strength inverts", () => {
  const img = stripes();
  const field = computeDetailField(img, { radius: 1, blur: 1, tolerance: 0.05 });
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(24, 24));
  slab.controlPoints = [v2(-24, -24), v2(24, -24), v2(24, 24), v2(-24, 24), v2(-24, -24), v2(24, -24), v2(24, 24), v2(-24, 24)];
  slab.ringSplit = 4;
  slab.transform.scale = slab.transform.scale.withZ(10 / 24);
  const adj = createObjectInstance(ObjectTypeId.Adjust, v2(24, 24));
  adj.adjustments = [{ ...createAdjustment("detail"), params: { radius: 1, strength: 0.5, blur: 1, tolerance: 0.05 } }];
  const out = evaluateField(resolveObjects([slab, adj]), 48, 48, { detail: { field, scale: 1 } });
  const at = (x: number): number => out.heightMap[24 * 48 + x]!;
  expect(at(24)).toBeGreaterThan(at(8) + 0.5); // stripe embossed above the surround
  adj.adjustments = [{ ...createAdjustment("detail"), params: { radius: 1, strength: -0.5, blur: 1, tolerance: 0.05 } }];
  const inv = evaluateField(resolveObjects([slab, adj]), 48, 48, { detail: { field, scale: 1 } });
  expect(inv.heightMap[24 * 48 + 24]!).toBeLessThan(inv.heightMap[24 * 48 + 8]! - 0.5);
  // no detail context -> no-op
  const noCtx = evaluateField(resolveObjects([slab, adj]), 48, 48);
  expect(noCtx.heightMap[24 * 48 + 24]!).toBeCloseTo(10, 4);
});

test("box-blur path (sigma > 2) tracks the exact gaussian closely", () => {
  // straddle the switchover: 2.0 = exact kernel, 2.01 = 3-box normalized convolution
  const exact = computeDetailField(stripes(), { radius: 1, blur: 2.0, tolerance: 0.05 });
  const boxed = computeDetailField(stripes(), { radius: 1, blur: 2.01, tolerance: 0.05 });
  let maxAbs = 0;
  let maxDiff = 0;
  for (let i = 0; i < exact.data.length; i += 4) {
    maxAbs = Math.max(maxAbs, Math.abs(exact.data[i]!));
    maxDiff = Math.max(maxDiff, Math.abs(exact.data[i]! - boxed.data[i]!));
  }
  expect(maxDiff).toBeLessThan(maxAbs * 0.1); // same relief, within 10% of peak
});

test("preview pass: a downsampled field carries its scale and approximates full res", () => {
  const full = computeDetailField(stripes(), { radius: 1, blur: 1, tolerance: 0.05 });
  const half = computeDetailField(stripes(), { radius: 1, blur: 1, tolerance: 0.05 }, 0.5);
  expect(full.scale).toBe(1);
  expect(half.width).toBe(24);
  expect(half.scale).toBeCloseTo(0.5, 5);
  // sampled in doc space via the scale, the preview lands near the full-res relief
  const fullOn = sampleDetail(full, 24.5, 24.5)[0];
  const halfOn = sampleDetail(half, 24.5 * half.scale, 24.5 * half.scale)[0];
  const fullOff = sampleDetail(full, 8.5, 24.5)[0];
  const halfOff = sampleDetail(half, 8.5 * half.scale, 24.5 * half.scale)[0];
  expect(halfOn - halfOff).toBeGreaterThan((fullOn - fullOff) * 0.4); // same raised stripe, preview-quality
});

test("transparency reads as dark: a bright shape on transparent ground gets a rim response", () => {
  // bright opaque square centred on a fully transparent canvas
  const w = 48;
  const data = new Uint8Array(w * w * 4);
  for (let y = 16; y < 32; y++) {
    for (let x = 16; x < 32; x++) {
      const i = (y * w + x) * 4;
      data[i] = 220;
      data[i + 1] = 220;
      data[i + 2] = 220;
      data[i + 3] = 255;
    }
  }
  const field = computeDetailField({ data, width: w, height: w, channels: 4 }, { radius: 1, blur: 1, tolerance: 0.05 });
  const centre = sampleDetail(field, 24, 24)[0];
  const rim = sampleDetail(field, 16.5, 24)[0]; // just inside the silhouette
  // the square integrates to a raised plateau against the dark (transparent) surround
  expect(centre).toBeGreaterThan(0.5);
  expect(rim).toBeGreaterThan(0); // raised at the rim too, not gated to flat
});

test("alpha scales luminance: half-transparent white reads as mid-gray", () => {
  // left half opaque white, right half 50%-alpha white -> a real luminance edge at the seam
  const w = 48;
  const data = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = x < 24 ? 255 : 128;
    }
  }
  const field = computeDetailField({ data, width: w, height: w, channels: 4 }, { radius: 1, blur: 1, tolerance: 0.05 });
  const opaqueSide = sampleDetail(field, 12, 24)[0];
  const fadedSide = sampleDetail(field, 36, 24)[0];
  expect(opaqueSide).toBeGreaterThan(fadedSide + 0.5); // the faded half is LOWER (darker)
});

test("silhouette rim: no opposite-tilt fringe, no Nyquist ringing", () => {
  // an ANTIALIASED diagonal silhouette on transparency — the artwork case that fringed: the old
  // zero-clipped transparent texels put a step-up valley outside the rim (opposite normals under
  // supersampling), and the sin-form FC operator rang a +-checkerboard across the whole field
  const w = 48;
  const data = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const t = x - y + 16;
      const a = t >= 10 && t < 26 ? 255 : (t >= 9 && t < 10) || (t >= 26 && t < 27) ? 128 : 0;
      const i = (y * w + x) * 4;
      data[i] = 200;
      data[i + 1] = 200;
      data[i + 2] = 200;
      data[i + 3] = a;
    }
  }
  const field = computeDetailField({ data, width: w, height: w, channels: 4 }, { radius: 1, blur: 1, tolerance: 0.05 });
  const row = 24;
  const at = (x: number): number => field.data[(row * w + x) * 4]!;
  // rim is MONOTONIC from outside to plateau: no valley, so no opposite slope exists to derive
  for (let x = 16; x < 21; x++) expect(at(x + 1)).toBeGreaterThan(at(x) - 1e-3);
  // the transparent far field sits near 0 (rebased), smooth: no +-checkerboard ringing
  for (let x = 4; x < 12; x++) expect(Math.abs(at(x))).toBeLessThan(0.4);
  // the interior plateau is flat to ~1% of its height (the sin-operator jitter was ~+-3%)
  const plateau = [at(22), at(23), at(24), at(25), at(26)];
  const mean = plateau.reduce((a, b) => a + b) / plateau.length;
  for (const v of plateau) expect(Math.abs(v - mean)).toBeLessThan(mean * 0.01);
});
