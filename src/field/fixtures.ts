import "./shapes";
import { convertToMesh } from "./meshConvert";
import { createShapeInstance } from "./registry";
import type { ShapeInstance } from "./types";
import { v2 } from "./vec";

/** A converted, vertex-tweaked plateau — exercises the mesh GPU path in the drift selftest. */
export function meshShapes(): ShapeInstance[] {
  const plateau = createShapeInstance("plateau", v2(48, 48));
  plateau.transform.rotation = 0.3;
  plateau.transform.scale = { x: 1.2, y: 0.9, z: 1.1 };
  const mesh = convertToMesh(plateau);
  mesh.id = "stress-mesh";
  mesh.mesh!.z[4] = 34; // skew one top corner so the surface isn't a flat prism
  mesh.controlPoints[6] = v2(14, 26); // nudge a top vertex in xy
  return [mesh];
}

/** Deterministic fixture exercising all four v1 shapes and blending. */
export function goldenShapes(): ShapeInstance[] {
  const slab = createShapeInstance("plateau", v2(40, 48));
  slab.id = "slab";
  const dome = createShapeInstance("dome", v2(40, 48));
  dome.id = "dome";
  dome.transform.scale = { x: 16 / 48, y: 16 / 48, z: 36 / 48 }; // 16px footprint, 36px tall
  const ridge = createShapeInstance("ridge", v2(72, 24));
  ridge.id = "ridge";
  ridge.transform.rotation = Math.PI / 6;
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
  dome.transform.pos.z = 5; // exercise the elevation slot in the GPU drift test
  const ridge = createShapeInstance("ridge", v2(48, 60));
  ridge.id = "stress-ridge";
  ridge.transform.rotation = -0.4;
  ridge.transform.scale.z = 0.8;
  const groove = createShapeInstance("groove", v2(48, 40));
  groove.id = "stress-groove";
  groove.transform.rotation = 0.7;
  return [dome, ridge, groove];
}

export const GOLDEN_W = 96;
export const GOLDEN_H = 96;
