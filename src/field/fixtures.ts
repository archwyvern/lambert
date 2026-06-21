import { Vector3 } from "@carapace/primitives";
import "./shapes";
import { bezierAnchor } from "./bezier";
import { meshEdges } from "./meshOps";
import { createShapeInstance } from "./registry";
import type { GroupLayer, LayerNode, Mask, ShapeInstance } from "./types";
import { v2 } from "./vec";

/** An irregular sculpted mesh (4 corners + a raised off-centre peak, non-coplanar facets) under a
 *  rotation + non-uniform scale, with smoothness on — exercises the mesh GPU path (barycentric +
 *  Phong + outline SD) GPU==CPU in the drift selftest. */
export function meshShapes(): ShapeInstance[] {
  const mesh = createShapeInstance("mesh", v2(48, 48));
  mesh.id = "stress-mesh";
  mesh.transform.rotation = 0.3;
  mesh.transform.scale = new Vector3(1.2, 0.9, 1.1);
  mesh.controlPoints = [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32), v2(6, -4)];
  const z = [4, 0, 8, 2, 34]; // corners low + varied, an off-centre peak — facets are non-coplanar
  const tris: [number, number, number][] = [
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ];
  mesh.mesh = { z, tris, edges: meshEdges({ z, tris }) };
  mesh.params.smoothness = 0.7; // exercise the Phong smoothness path (GPU vs CPU)
  return [mesh];
}

/** Deterministic fixture exercising all four v1 shapes and blending. */
export function goldenShapes(): ShapeInstance[] {
  const slab = createShapeInstance("plateau", v2(40, 48));
  slab.id = "slab";
  const dome = createShapeInstance("dome", v2(40, 48));
  dome.id = "dome";
  dome.transform.scale = new Vector3(16 / 48, 16 / 48, 36 / 48); // 16px footprint, 36px tall
  const capsule = createShapeInstance("capsule", v2(72, 24));
  capsule.id = "capsule";
  capsule.transform.rotation = Math.PI / 6;
  const groove = createShapeInstance("groove", v2(40, 72));
  groove.id = "groove";
  return [slab, dome, capsule, groove];
}

/** Transform stressor: rotation + non-uniform scale + blend, for the GPU drift test. */
export function stressShapes(): ShapeInstance[] {
  const dome = createShapeInstance("dome", v2(48, 40));
  dome.id = "stress-dome";
  dome.transform.rotation = 0.7;
  dome.transform.scale = new Vector3(1.5, 0.75, 1);
  dome.transform.pos = dome.transform.pos.withZ(5); // exercise the elevation slot in the GPU drift test
  const capsule = createShapeInstance("capsule", v2(48, 60));
  capsule.id = "stress-capsule";
  capsule.transform.rotation = -0.4;
  capsule.transform.scale = capsule.transform.scale.withZ(0.8);
  const groove = createShapeInstance("groove", v2(48, 40));
  groove.id = "stress-groove";
  groove.transform.rotation = 0.7;
  return [dome, capsule, groove];
}

/** A rotated, non-uniformly scaled tilted plane (diagonal tilt) — exercises the plane's slope ramp
 *  and the auto min-dot bias GPU==CPU in the drift selftest. */
export function planeShapes(): ShapeInstance[] {
  const plane = createShapeInstance("plane", v2(48, 48));
  plane.id = "tilt-plane";
  plane.transform.rotation = 0.35;
  plane.transform.scale = new Vector3(1.2, 0.9, 1);
  plane.transform.pos = plane.transform.pos.withZ(8); // elevation (the low edge floats 8px) + tilt
  plane.params.tiltX = 0.6;
  plane.params.tiltY = -0.45;
  return [plane];
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
  const cyl = createShapeInstance("cylinder", v2(48, 24));
  cyl.id = "p-cyl";
  cyl.params.length = 30;
  cyl.params.radius = 10;
  cyl.transform.rotation = 0.4;
  const frustum = createShapeInstance("frustum", v2(48, 72));
  frustum.id = "p-frustum";
  frustum.params.length = 34;
  frustum.params.radius = 12;
  frustum.params.radius2 = 5;
  frustum.transform.rotation = -0.3;
  return [cone, pyr, torus, wedge, fillet, cyl, frustum];
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

/** A rotated, non-uniformly scaled plateau with a local KEEP mask (one smooth anchor) and a world
 *  CUT mask — exercises both mask spaces, the distance-scale path, and the closed Catmull-Rom bake
 *  in the GPU-vs-CPU drift selftest. */
export function maskedShapes(): ShapeInstance[] {
  const slab = createShapeInstance("plateau", v2(48, 48));
  slab.id = "m-slab";
  slab.transform.rotation = 0.4;
  slab.transform.scale = new Vector3(1.3, 0.8, 1);
  slab.masks = [
    {
      id: "keep1",
      mode: "keep",
      follow: true, // local space; one smooth anchor so the closed curve bake is exercised
      anchors: [
        bezierAnchor(v2(-34, -30), v2(0, 0), v2(0, 0), "manual"),
        bezierAnchor(v2(36, -18)), // smooth (Catmull-Rom)
        bezierAnchor(v2(8, 34), v2(0, 0), v2(0, 0), "manual"),
      ],
    },
    {
      id: "cut1",
      mode: "cut",
      follow: false, // world/canvas space, pinned
      anchors: [v2(44, 40), v2(70, 40), v2(70, 66), v2(44, 66)].map((p) =>
        bezierAnchor(p, v2(0, 0), v2(0, 0), "manual"),
      ),
    },
  ];
  return [slab];
}

/** A group (rotation + non-uniform scale) wrapping a rotated dome + a capsule, beside a top-level
 *  shape — exercises the affine/shear composition path GPU==CPU in the drift selftest. */
export function nestedGroupLayers(): LayerNode[] {
  const dome = createShapeInstance("dome", v2(20, 0));
  dome.id = "ng-dome";
  dome.transform.rotation = 0.5;
  dome.transform.scale = new Vector3(0.5, 0.8, 1.1);
  const capsule = createShapeInstance("capsule", v2(-10, 14));
  capsule.id = "ng-capsule";
  capsule.transform.rotation = -0.3;
  const group: GroupLayer = {
    kind: "group",
    id: "ng-group",
    transform: { pos: new Vector3(48, 48, 4), rotation: 0.4, scale: new Vector3(1.4, 0.7, 1) },
    visible: true,
    locked: false,
    children: [dome, capsule],
  };
  const slab = createShapeInstance("plateau", v2(24, 72));
  slab.id = "ng-slab";
  return [group, slab];
}

/** An axis-aligned rectangular mask from a corner box (manual corner anchors). */
function boxMask(id: string, mode: "keep" | "cut", follow: boolean, x0: number, y0: number, x1: number, y1: number): Mask {
  return {
    id,
    mode,
    follow,
    anchors: [v2(x0, y0), v2(x1, y0), v2(x1, y1), v2(x0, y1)].map((p) => bezierAnchor(p, v2(0, 0), v2(0, 0), "manual")),
  };
}

/** A rotated group carrying a KEEP mask over its left half, wrapping a wide plateau that also has its
 *  own KEEP mask over its top half — exercises scope-aware coverage (group mask intersects the
 *  shape's own, world-baked through the group affine) GPU==CPU. */
export function scopedMaskGroupLayers(): LayerNode[] {
  const slab = createShapeInstance("plateau", v2(0, 0));
  slab.id = "sm-slab";
  slab.transform.scale = new Vector3(1.1, 1.1, 1);
  slab.masks = [boxMask("sm-own", "keep", true, -50, -50, 50, 6)]; // top half (local y < 6)
  const group: GroupLayer = {
    kind: "group",
    id: "sm-group",
    transform: { pos: new Vector3(48, 48, 2), rotation: 0.25, scale: new Vector3(1.2, 0.9, 1) },
    visible: true,
    locked: false,
    masks: [boxMask("sm-grp", "keep", true, -50, -50, 4, 50)], // left half (local x < 4)
    children: [slab],
  };
  return [group];
}

/** An x-mirror group: a dome centred on the axis (its source half + reflection = a whole symmetric
 *  dome) plus an off-axis capsule on the source (left) side that reflects to the right. The auto SOURCE
 *  clip cuts anything crossing the axis, so no manual mask is needed. Exercises reflected-instance
 *  emission + the auto half-plane clip GPU==CPU. */
export function mirrorXGroupLayers(): LayerNode[] {
  const dome = createShapeInstance("dome", v2(0, -10)); // straddles x=0: left half kept, reflected right
  dome.id = "mx-dome";
  dome.transform.scale = new Vector3(0.6, 0.7, 1.2);
  const capsule = createShapeInstance("capsule", v2(-18, 16)); // source (left) side
  capsule.id = "mx-capsule";
  capsule.transform.rotation = 0.3;
  capsule.transform.scale = new Vector3(0.7, 0.7, 1);
  const group: GroupLayer = {
    kind: "group",
    id: "mx-group",
    transform: { pos: new Vector3(48, 48, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
    visible: true,
    locked: false,
    mirror: "x",
    children: [dome, capsule],
  };
  return [group];
}

/** A quad-mirror group: a dome in the source (x<=0,y<=0) quadrant reflected into all four for 4-way
 *  radial symmetry, plus a CUT mask to prove the auto quadrant clip still intersects user masks.
 *  Exercises quad emission + auto quadrant clip GPU==CPU. */
export function mirrorQuadGroupLayers(): LayerNode[] {
  const dome = createShapeInstance("dome", v2(-14, -14)); // source quadrant; reflects into all 4
  dome.id = "mq-dome";
  dome.transform.scale = new Vector3(0.6, 0.6, 1.1);
  const group: GroupLayer = {
    kind: "group",
    id: "mq-group",
    transform: { pos: new Vector3(48, 48, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
    visible: true,
    locked: false,
    mirror: "quad",
    masks: [boxMask("mq-cut", "cut", true, -20, -20, -8, -8)], // a hole inside the source quadrant
    children: [dome],
  };
  return [group];
}

export const GOLDEN_W = 96;
export const GOLDEN_H = 96;
