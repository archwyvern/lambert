import { Vector3 } from "@carapace/primitives";
import "./shapes";
import { bezierAnchor } from "./bezier";
import { convertToMesh } from "./meshConvert";
import { createShapeInstance } from "./registry";
import type { ShapeInstance } from "./types";
import { v2 } from "./vec";

/** A converted, vertex-tweaked plateau — exercises the mesh GPU path in the drift selftest. */
export function meshShapes(): ShapeInstance[] {
  const plateau = createShapeInstance("plateau", v2(48, 48));
  plateau.transform.rotation = 0.3;
  plateau.transform.scale = new Vector3(1.2, 0.9, 1.1);
  const mesh = convertToMesh(plateau);
  mesh.id = "stress-mesh";
  mesh.mesh!.z[4] = 34; // skew one top corner so the surface isn't a flat prism
  mesh.controlPoints[6] = v2(14, 26); // nudge a top vertex in xy
  mesh.params.smoothness = 0.7; // exercise the Phong smoothness path (GPU vs CPU) in the selftest
  return [mesh];
}

/** Deterministic fixture exercising all four v1 shapes and blending. */
export function goldenShapes(): ShapeInstance[] {
  const slab = createShapeInstance("plateau", v2(40, 48));
  slab.id = "slab";
  const dome = createShapeInstance("dome", v2(40, 48));
  dome.id = "dome";
  dome.transform.scale = new Vector3(16 / 48, 16 / 48, 36 / 48); // 16px footprint, 36px tall
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
  dome.transform.scale = new Vector3(1.5, 0.75, 1);
  dome.transform.pos = dome.transform.pos.withZ(5); // exercise the elevation slot in the GPU drift test
  const ridge = createShapeInstance("ridge", v2(48, 60));
  ridge.id = "stress-ridge";
  ridge.transform.rotation = -0.4;
  ridge.transform.scale = ridge.transform.scale.withZ(0.8);
  const groove = createShapeInstance("groove", v2(48, 40));
  groove.id = "stress-groove";
  groove.transform.rotation = 0.7;
  return [dome, ridge, groove];
}

/** One of each parametric primitive (cone/pyramid/torus/wedge/fillet) with scale + rotation,
 *  for the GPU-vs-CPU drift selftest. */
export function primitivesShapes(): ShapeInstance[] {
  const cone = createShapeInstance("cone", v2(26, 26));
  cone.id = "p-cone";
  cone.transform.scale = new Vector3(0.42, 0.42, 1.2);
  const pyr = createShapeInstance("pyramid", v2(70, 26));
  pyr.id = "p-pyr";
  pyr.transform.rotation = 0.5;
  pyr.transform.scale = new Vector3(0.42, 0.42, 1);
  const torus = createShapeInstance("torus", v2(26, 70));
  torus.id = "p-torus";
  torus.transform.scale = new Vector3(0.5, 0.5, 1);
  const wedge = createShapeInstance("wedge", v2(70, 70));
  wedge.id = "p-wedge";
  wedge.transform.rotation = 0.3;
  wedge.transform.scale = new Vector3(0.42, 0.42, 1);
  const fillet = createShapeInstance("fillet", v2(48, 48));
  fillet.id = "p-fillet";
  fillet.transform.scale = new Vector3(0.3, 0.3, 1);
  return [cone, pyr, torus, wedge, fillet];
}

/** Curved multi-anchor cables (round + flat profile) for the GPU-vs-CPU drift selftest — proves
 *  the Catmull-Rom dense spine walks identically on CPU and GPU. */
export function cableShapes(): ShapeInstance[] {
  const round = createShapeInstance("cable", v2(30, 42));
  round.id = "c-round";
  // smooth (Catmull-Rom) path: handles are derived from neighbours, exercising resolveHandles
  round.bezier = [
    bezierAnchor(v2(-26, -16)),
    bezierAnchor(v2(2, 8)),
    bezierAnchor(v2(30, 16)),
  ];
  round.transform.scale = new Vector3(0.7, 0.7, 1);
  const flat = createShapeInstance("cable", v2(64, 56));
  flat.id = "c-flat";
  flat.params.profile = "flat";
  flat.params.thickness = 22;
  flat.params.slope = 5;
  // manual path with long tangents: exercises the robust cubic_dist + flat end-caps on GPU vs CPU
  flat.bezier = [
    bezierAnchor(v2(-22, 18), v2(0, 0), v2(40, -34), "manual"),
    bezierAnchor(v2(26, 10), v2(40, -34), v2(0, 0), "manual"),
  ];
  flat.transform.scale = new Vector3(0.55, 0.55, 1);
  return [round, flat];
}

export const GOLDEN_W = 96;
export const GOLDEN_H = 96;
