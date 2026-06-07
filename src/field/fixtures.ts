import "./shapes";
import { createShapeInstance } from "./registry";
import type { ShapeInstance } from "./types";
import { v2 } from "./vec";

/** Deterministic fixture exercising all four v1 shapes and blending. */
export function goldenShapes(): ShapeInstance[] {
  const slab = createShapeInstance("plateau", v2(40, 48));
  slab.id = "slab";
  const dome = createShapeInstance("dome", v2(40, 48));
  dome.id = "dome";
  dome.params = { ...dome.params, radiusX: 16, radiusY: 16 };
  dome.transform.scale.z = 1.5; // 36px: out-talls the slab
  const ridge = createShapeInstance("ridge", v2(72, 24));
  ridge.id = "ridge";
  ridge.transform.rotation = Math.PI / 6;
  ridge.combine = { blend: 6 };
  const groove = createShapeInstance("groove", v2(40, 72));
  groove.id = "groove";
  return [slab, dome, ridge, groove];
}

/** Transform stressor: rotation + non-uniform scale + blend, for the GPU drift test. */
export function stressShapes(): ShapeInstance[] {
  const dome = createShapeInstance("dome", v2(48, 40));
  dome.id = "stress-dome";
  dome.transform.rotation = 0.7;
  dome.transform.scale = { x: 1.5, y: 0.75, z: 1 };
  const ridge = createShapeInstance("ridge", v2(48, 60));
  ridge.id = "stress-ridge";
  ridge.transform.rotation = -0.4;
  ridge.combine = { blend: 5 };
  ridge.transform.scale.z = 0.8;
  const groove = createShapeInstance("groove", v2(48, 40));
  groove.id = "stress-groove";
  groove.transform.rotation = 0.7;
  groove.combine = { blend: 3 };
  return [dome, ridge, groove];
}

export const GOLDEN_W = 96;
export const GOLDEN_H = 96;
