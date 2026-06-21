import { describe, expect, it } from "vitest";
import { Vector2, Vector3 } from "@carapace/primitives";
import "../../src/field/shapes";
import { evaluateField } from "../../src/field/evalCpu";
import { renderField } from "../../src/field/render";
import { resolveShapes } from "../../src/field/flatten";
import { createShapeInstance } from "../../src/field/registry";
import { createMask } from "../../src/field/maskOps";
import type { ShapeInstance } from "../../src/field/types";

const v = (x: number, y: number): Vector2 => new Vector2(x, y);
const at = (m: Float32Array, w: number, x: number, y: number): number => m[y * w + x]!;

function slabWithKeep(): ShapeInstance {
  const slab = createShapeInstance("plateau", v(32, 32)); // covers most of a 64x64 canvas
  slab.transform.scale = new Vector3(1.2, 1.2, 1);
  // world-space keep square over the canvas centre (24..40)
  slab.masks = [createMask([v(24, 24), v(40, 24), v(40, 40), v(24, 40)], false)];
  return slab;
}

describe("mask trim (CPU)", () => {
  it("a keep mask zeroes height + NX mask outside the loop, keeps them inside", () => {
    const f = evaluateField(resolveShapes([slabWithKeep()]), 64, 64);
    expect(at(f.mask, 64, 32, 32)).toBeGreaterThan(0.5); // inside keep
    expect(at(f.heightMap, 64, 32, 32)).toBeGreaterThan(0);
    expect(at(f.mask, 64, 5, 5)).toBe(0); // outside keep -> trimmed, no NX alpha
    expect(at(f.heightMap, 64, 5, 5)).toBe(0);
  });

  it("a world mask lands at the same doc location at ss1 and ss2 (supersample scaling)", () => {
    const r1 = renderField(resolveShapes([slabWithKeep()]), 64, 64, { supersample: 1 });
    const r2 = renderField(resolveShapes([slabWithKeep()]), 64, 64, { supersample: 2 });
    expect(at(r1.mask, 64, 32, 32)).toBeGreaterThan(0.5);
    expect(at(r2.mask, 64, 32, 32)).toBeGreaterThan(0.5);
    expect(at(r1.mask, 64, 5, 5)).toBeCloseTo(0, 5);
    expect(at(r2.mask, 64, 5, 5)).toBeCloseTo(0, 5);
  });
});
