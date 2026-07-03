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
      if (noise > 0) v += (x % 2 === 0 ? 1 : -1) * noise; // 1px vertical jitter stripes (strong Sobel-x)
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
