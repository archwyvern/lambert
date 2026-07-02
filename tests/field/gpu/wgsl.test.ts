import { expect, test } from "vitest";
import "../../../src/field/objects";
import { allObjectTypes } from "../../../src/field/registry";
import { buildFoldWgsl, buildNormalWgsl, MAX_PARAMS, objectWgslFn, PARAMS_OFFSET, RECORD_F32, RECORD_SLOT } from "../../../src/field/gpu/wgsl";

test("RECORD_SLOT map is internally consistent and mirrored into the WGSL", () => {
  // the derived constants must stay in lockstep with the slot map (pack.ts + every object read these)
  expect(RECORD_F32).toBe(RECORD_SLOT.OPACITY + 1);
  expect(PARAMS_OFFSET).toBe(RECORD_SLOT.PARAM0);
  expect(MAX_PARAMS).toBe(RECORD_SLOT.ELEVATION - RECORD_SLOT.PARAM0);
  expect(RECORD_SLOT.PARAM7).toBeLessThan(RECORD_SLOT.ELEVATION); // params (+holes) must end before elevation
  // every slot is emitted as a WGSL const, so a renumber propagates to the shaders automatically
  const src = buildFoldWgsl();
  for (const [k, v] of Object.entries(RECORD_SLOT)) {
    expect(src, `SLOT_${k}`).toContain(`const SLOT_${k}: u32 = ${v}u;`);
  }
  // no bare rec(base, <int>u) slot literals should survive in the generated fold source
  expect(/rec\(base, \d+u/.test(src)).toBe(false);
});

test("fold module contains common lib, every object fn, and the dispatch switch", () => {
  const src = buildFoldWgsl();
  for (const fn of ["fn combine_height", "fn influence", "fn apply_profile", "fn sd_polygon", "fn sd_segment", "fn to_local", "fn fold("]) {
    expect(src, fn).toContain(fn);
  }
  for (const t of allObjectTypes()) {
    if (!t.wgsl) continue;
    expect(src).toContain(`fn ${objectWgslFn(t.name)}(`);
  }
  // typeIndex i maps to the i-th wgsl-bearing registration; index 0 is the default arm
  // (WGSL requires default last), the rest are explicit cases
  const order = allObjectTypes().filter((t) => t.wgsl);
  order.forEach((t, i) => {
    const fn = objectWgslFn(t.name);
    if (i === 0) {
      expect(src).toContain(`default: { return ${fn}(p, base); }`);
    } else {
      expect(src).toContain(`case ${i}u: { return ${fn}(p, base); }`);
    }
  });
});

test("normal module declares the pass entry point", () => {
  const src = buildNormalWgsl();
  expect(src).toContain("fn normals(");
  expect(src).toContain("slopeScale");
});

test("braces balance in both modules (cheap syntax sanity)", () => {
  for (const src of [buildFoldWgsl(), buildNormalWgsl()]) {
    let depth = 0;
    for (const ch of src) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  }
});
