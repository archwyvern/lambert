import { encode } from "fast-png";
import { expect, test } from "vitest";
import "../../src/field/objects";
import { createAdjustment } from "../../src/field/adjustments";
import { computeDetailField, detailFieldForDiffuse, sampleDetail } from "../../src/field/detail";
import { evaluateField } from "../../src/field/evalCpu";
import { resolveObjects } from "../../src/field/flatten";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

/** A 48x48 rgba with a bright 8px vertical stripe at x=24 on a mid-gray field. */
function stripes(): { data: Uint8Array; width: number; height: number; channels: number } {
  const w = 48;
  const h = 48;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bright = x >= 20 && x < 28;
      const v = bright ? 230 : 100;
      data[(y * w + x) * 4] = v;
      data[(y * w + x) * 4 + 1] = v;
      data[(y * w + x) * 4 + 2] = v;
      data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { data, width: w, height: h, channels: 4 };
}

test("detail bands: band-pass peaks on the luminance feature, flat areas stay ~0", () => {
  const field = computeDetailField(stripes());
  const [fineOn] = sampleDetail(field, 24.5, 24.5); // stripe centre
  const [fineOff] = sampleDetail(field, 6.5, 24.5); // far flat area
  expect(fineOn).toBeGreaterThan(0.3); // bright feature -> positive band
  expect(Math.abs(fineOff)).toBeLessThan(0.05); // DoG cancels flat lighting
  // a band is normalized to [-1, 1]
  for (let i = 0; i < field.data.length; i++) expect(Math.abs(field.data[i]!)).toBeLessThanOrEqual(1);
});

test("detailFieldForDiffuse caches per byte buffer", () => {
  const bytes = new Uint8Array(encode({ width: 48, height: 48, data: stripes().data }));
  const a = detailFieldForDiffuse(bytes);
  expect(detailFieldForDiffuse(bytes)).toBe(a);
});

test("fold: a detail adjustment embosses the accumulated surface from the bands", () => {
  const img = stripes();
  const field = computeDetailField(img);
  // a flat 10-tall plateau across the canvas + a full-canvas detail adjustment
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(24, 24));
  slab.controlPoints = [v2(-24, -24), v2(24, -24), v2(24, 24), v2(-24, 24), v2(-24, -24), v2(24, -24), v2(24, 24), v2(-24, 24)];
  slab.ringSplit = 4;
  slab.transform.scale = slab.transform.scale.withZ(10 / 24);
  const adj = createObjectInstance(ObjectTypeId.Adjust, v2(24, 24));
  adj.adjustments = [{ ...createAdjustment("detail"), params: { amount: 4, fine: 1, medium: 0, large: 0 } }];
  const out = evaluateField(resolveObjects([slab, adj]), 48, 48, { detail: { field, scale: 1 } });
  const at = (x: number, y: number): number => out.heightMap[y * 48 + x]!;
  expect(at(24, 24)).toBeGreaterThan(at(6, 24) + 1); // stripe embossed above the flat surround
  // negative amount inverts (dark-high)
  adj.adjustments = [{ ...createAdjustment("detail"), params: { amount: -4, fine: 1, medium: 0, large: 0 } }];
  const inv = evaluateField(resolveObjects([slab, adj]), 48, 48, { detail: { field, scale: 1 } });
  expect(inv.heightMap[24 * 48 + 24]!).toBeLessThan(inv.heightMap[24 * 48 + 6]! - 1);
  // without a detail context the adjustment is a no-op (not garbage)
  const noCtx = evaluateField(resolveObjects([slab, adj]), 48, 48);
  expect(noCtx.heightMap[24 * 48 + 24]!).toBeCloseTo(10, 4);
});
