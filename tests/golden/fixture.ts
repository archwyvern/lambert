import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import type { ShapeInstance } from "../../src/field/types";
import { v2 } from "../../src/field/vec";

/** Deterministic fixture exercising all four v1 shapes, every combine op, and blending. */
export function goldenShapes(): ShapeInstance[] {
  const slab = createShapeInstance("plateau", v2(40, 48));
  slab.id = "slab";
  const dome = createShapeInstance("dome", v2(40, 48));
  dome.id = "dome";
  dome.params = { ...dome.params, radiusX: 16, radiusY: 16, height: 8 };
  dome.combine = { op: "add", blend: 0 };
  const ridge = createShapeInstance("ridge", v2(72, 24));
  ridge.id = "ridge";
  ridge.transform.rotation = Math.PI / 6;
  ridge.combine = { op: "raise", blend: 6 };
  const groove = createShapeInstance("groove", v2(40, 72));
  groove.id = "groove";
  return [slab, dome, ridge, groove];
}

export const GOLDEN_W = 96;
export const GOLDEN_H = 96;
