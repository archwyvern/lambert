import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { allShapeTypes } from "../../../src/field/registry";
import { buildFoldWgsl, buildNormalWgsl } from "../../../src/field/gpu/wgsl";

test("fold module contains common lib, every shape fn, and the dispatch switch", () => {
  const src = buildFoldWgsl();
  for (const fn of ["fn smax", "fn combine_height", "fn influence", "fn apply_profile", "fn sd_polygon", "fn sd_ellipse", "fn sd_segment", "fn shape_spine", "fn to_local", "fn fold("]) {
    expect(src, fn).toContain(fn);
  }
  for (const t of allShapeTypes()) {
    if (!t.wgsl) continue;
    expect(src).toContain(`fn shape_${t.id.replace(/-/g, "_")}(`);
  }
  // typeIndex i maps to the i-th wgsl-bearing registration; index 0 is the default arm
  // (WGSL requires default last), the rest are explicit cases
  const order = allShapeTypes().filter((t) => t.wgsl);
  order.forEach((t, i) => {
    const fn = `shape_${t.id.replace(/-/g, "_")}`;
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
