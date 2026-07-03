import { Vector3 } from "@carapace/primitives";
import "./objects";
import { bakeRings, bezierAnchor } from "./bezier";
import { meshEdges } from "./meshOps";
import { createObjectInstance, ObjectTypeId } from "./registry";
import type { GroupLayer, LayerNode, Mask, ObjectInstance } from "./types";
import { v2 } from "./vec";

/** An irregular sculpted mesh (4 corners + a raised off-centre peak, non-coplanar facets) under a
 *  rotation + non-uniform scale, with smoothness on — exercises the mesh GPU path (barycentric +
 *  Phong + outline SD) GPU==CPU in the drift selftest. */
export function meshObjects(): ObjectInstance[] {
  const mesh = createObjectInstance(ObjectTypeId.Mesh, v2(48, 48));
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

/** Deterministic fixture exercising all four v1 objects and blending. */
export function goldenObjects(): ObjectInstance[] {
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(40, 48));
  slab.id = "slab";
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(40, 48));
  dome.id = "dome";
  dome.transform.scale = new Vector3(16 / 48, 16 / 48, 36 / 48); // 16px footprint, 36px tall
  dome.aa = true; // one AA-edged object: pins the box-filter coverage path in goldens + drift parity
  const capsule = createObjectInstance(ObjectTypeId.Pipe, v2(72, 24));
  capsule.id = "capsule";
  capsule.transform.rotation = Math.PI / 6;
  const groove = createObjectInstance(ObjectTypeId.PipeVector, v2(40, 72));
  groove.id = "groove";
  groove.params.invert = "carve"; // a carved channel along the path
  return [slab, dome, capsule, groove];
}

/** Transform stressor: rotation + non-uniform scale + blend, for the GPU drift test. */
export function stressObjects(): ObjectInstance[] {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(48, 40));
  dome.id = "stress-dome";
  dome.transform.rotation = 0.7;
  dome.transform.scale = new Vector3(1.5, 0.75, 1);
  dome.transform.pos = dome.transform.pos.withZ(5); // exercise the elevation slot in the GPU drift test
  const capsule = createObjectInstance(ObjectTypeId.Pipe, v2(48, 60));
  capsule.id = "stress-capsule";
  capsule.transform.rotation = -0.4;
  capsule.transform.scale = capsule.transform.scale.withZ(0.8);
  capsule.opacity = 0.5; // exercise the per-object opacity slot (GPU parity for the fold lerp)
  const groove = createObjectInstance(ObjectTypeId.PipeVector, v2(48, 40));
  groove.id = "stress-groove";
  groove.params.invert = "carve";
  groove.transform.rotation = 0.7;
  return [dome, capsule, groove];
}

/** A rotated, non-uniformly scaled tilted plane (diagonal tilt) — exercises the plane's slope ramp
 *  and the auto min-dot bias GPU==CPU in the drift selftest. */
export function surfaceObjects(): ObjectInstance[] {
  const plane = createObjectInstance(ObjectTypeId.Surface, v2(48, 48));
  plane.id = "tilt-plane";
  plane.transform.rotation = 0.35;
  plane.transform.scale = new Vector3(1.2, 0.9, 1);
  plane.transform.pos = plane.transform.pos.withZ(8); // elevation (the low edge floats 8px) + tilt
  plane.params.tiltX = 0.6;
  plane.params.tiltY = -0.45;
  // an angled Gradient effect region over the corner — parity for the region-normalised ramp
  const grad = createObjectInstance(ObjectTypeId.Gradient, v2(70, 70));
  grad.id = "fx-gradient";
  grad.params.angle = 35;
  grad.params.depth = 10;
  grad.transform.rotation = 0.25;
  grad.transform.scale = new Vector3(0.5, 0.4, 1);
  return [plane, grad];
}

/** One of each parametric primitive (cone/pyramid/torus/wedge/fillet) with scale + rotation,
 *  for the GPU-vs-CPU drift selftest. */
export function primitivesObjects(): ObjectInstance[] {
  const cone = createObjectInstance(ObjectTypeId.Sphere, v2(26, 26));
  cone.id = "p-cone";
  cone.params.profile = "linear"; // Cone = Sphere with a linear profile

  cone.transform.scale = new Vector3(0.42, 0.42, 1.2);
  const pyr = createObjectInstance(ObjectTypeId.Plateau, v2(70, 26)); // Plateau with a single apex = pyramid
  pyr.id = "p-pyr";
  pyr.controlPoints = [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32), v2(0, 0)];
  pyr.ringSplit = 4;
  pyr.transform.rotation = 0.5;
  pyr.transform.scale = new Vector3(0.42, 0.42, 1);
  const torus = createObjectInstance(ObjectTypeId.Torus, v2(26, 70));
  torus.id = "p-torus";
  torus.transform.scale = new Vector3(0.5, 0.5, 1);
  const wedge = createObjectInstance(ObjectTypeId.Ramp, v2(70, 70)); // default linear = wedge
  wedge.id = "p-wedge";
  wedge.transform.rotation = 0.3;
  wedge.transform.scale = new Vector3(0.42, 0.42, 1);
  const fillet = createObjectInstance(ObjectTypeId.Ramp, v2(48, 48));
  fillet.id = "p-fillet";
  fillet.params.profile = "cove"; // cove = fillet
  fillet.transform.scale = new Vector3(0.3, 0.3, 1);
  const cyl = createObjectInstance(ObjectTypeId.Pipe, v2(48, 24)); // flat cap = cylinder
  cyl.id = "p-cyl";
  cyl.params.cap = "flat";
  cyl.params.length = 30;
  cyl.params.radius = 10;
  cyl.params.radius2 = 10; // uniform (no taper)
  cyl.transform.rotation = 0.4;
  const frustum = createObjectInstance(ObjectTypeId.Pipe, v2(48, 72)); // flat cap + taper = frustum
  frustum.id = "p-frustum";
  frustum.params.cap = "flat";
  frustum.params.length = 34;
  frustum.params.radius = 12;
  frustum.params.radius2 = 5;
  frustum.transform.rotation = -0.3;
  return [cone, pyr, torus, wedge, fillet, cyl, frustum];
}

/** Curved multi-anchor pipes (round + flat-cap linear) for the GPU-vs-CPU drift selftest — proves
 *  the Catmull-Rom dense spine + robust cubic_dist walk identically on CPU and GPU. The round one is a
 *  CLOSED loop with PER-ANCHOR radii, so it also covers the wrap segment + the radius-taper path. */
export function pipeObjects(): ObjectInstance[] {
  const round = createObjectInstance(ObjectTypeId.PipeVector, v2(30, 42));
  round.id = "p-round";
  // smooth (Catmull-Rom) closed loop with varying per-anchor scale: exercises resolveHandlesClosed,
  // the wrap segment, and cubic_dist_t taper interpolation GPU==CPU (radius 8 · scale).
  round.bezier = [
    { ...bezierAnchor(v2(-26, -16)), scale: 1.25 },
    { ...bezierAnchor(v2(2, 8)), scale: 0.625 },
    { ...bezierAnchor(v2(30, 16)), scale: 1 },
  ];
  round.closed = true;
  round.transform.scale = new Vector3(0.7, 0.7, 1);
  const flat = createObjectInstance(ObjectTypeId.PipeVector, v2(64, 56));
  flat.id = "p-flat";
  flat.params.profile = "linear";
  flat.params.cap = "flat";
  flat.params.radius = 11;
  // manual path with long tangents: exercises the robust cubic_dist + flat end-caps on GPU vs CPU
  flat.bezier = [
    bezierAnchor(v2(-22, 18), v2(0, 0), v2(40, -34), "manual"),
    bezierAnchor(v2(26, 10), v2(40, -34), v2(0, 0), "manual"),
  ];
  flat.transform.scale = new Vector3(0.55, 0.55, 1);
  return [round, flat];
}

/** Berm + Ridge: flat-cap, round-cap, slope=0 (vertical sides), and a CLOSED BermVector loop.
 *  Both berm WGSL paths had zero drift coverage — including the load-bearing hardcoded apply_profile(1u)
 *  linear index (the class of bug that shipped before). Wired into runSelftest. */
export function bermObjects(): ObjectInstance[] {
  const flat = createObjectInstance(ObjectTypeId.Berm, v2(28, 24));
  flat.id = "berm-flat";
  flat.params.length = 44;
  flat.params.width = 12;
  flat.params.slope = 5;
  flat.params.height = 14;
  flat.params.cap = "flat";
  flat.transform.rotation = 0.4;
  flat.transform.scale = new Vector3(0.9, 1.1, 1);

  const round = createObjectInstance(ObjectTypeId.Berm, v2(66, 30));
  round.id = "berm-round";
  round.params.length = 36;
  round.params.width = 10;
  round.params.slope = 6;
  round.params.height = 10;
  round.params.cap = "round";
  round.transform.rotation = -0.25;

  const vertical = createObjectInstance(ObjectTypeId.Berm, v2(30, 68));
  vertical.id = "berm-vertical";
  vertical.params.length = 40;
  vertical.params.width = 9;
  vertical.params.slope = 0; // vertical sides: apply_profile clamps hard (width<=0 branch) — GPU==CPU
  vertical.params.height = 12;
  vertical.params.cap = "flat";

  const loop = createObjectInstance(ObjectTypeId.BermVector, v2(66, 66));
  loop.id = "berm-loop";
  loop.params.width = 8;
  loop.params.slope = 4;
  loop.params.height = 11;
  // per-anchor SCALE taper (width+slope+height as a unit) — covers the stroke-taper path GPU==CPU
  loop.bezier = [
    { ...bezierAnchor(v2(-16, -14)), scale: 1.4 },
    { ...bezierAnchor(v2(18, -8)), scale: 0.7 },
    bezierAnchor(v2(4, 18)),
  ];
  loop.closed = true;
  loop.transform.scale = new Vector3(0.8, 0.8, 1);

  return [flat, round, vertical, loop];
}

/** The baked multi-contour Bézier vectors for the GPU-vs-CPU drift selftest: a Contour with a
 *  HOLE (outer ring + inner hole, CSG-subtracted) and a Mesa (base + top Bézier rings),
 *  both under a rotation + scale — proves the ringSplit hole/ramp paths match GPU==CPU. */
export function vectorFillObjects(): ObjectInstance[] {
  const frame = createObjectInstance(ObjectTypeId.SurfaceVector, v2(34, 40));
  frame.id = "v-frame";
  frame.transform.rotation = 0.3;
  frame.transform.scale = new Vector3(0.7, 0.7, 1);
  const corner = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
  frame.bezier = [...frame.bezier!, corner(-12, -12), corner(12, -12), corner(12, 12), corner(-12, 12)]; // + a hole
  frame.subpathStarts = [0, 4];
  const fr = bakeRings(frame.bezier, frame.subpathStarts);
  frame.controlPoints = fr.controlPoints;
  frame.ringSplit = fr.ringSplit;
  frame.contourCounts = fr.contourCounts;
  const mesa = createObjectInstance(ObjectTypeId.PlateauVector, v2(64, 56));
  mesa.id = "v-mesa";
  mesa.transform.rotation = -0.4;
  mesa.transform.scale = new Vector3(0.6, 0.6, 1);
  // a HOLED pillow under rotation + non-uniform scale: exercises the soft-distance boundary integral
  // (pillow_ring_inv over outer + hole rings) GPU==CPU, incl. the zero-param hole-slot packing
  const cushion = createObjectInstance(ObjectTypeId.Pillow, v2(30, 74));
  cushion.id = "v-cushion";
  cushion.transform.rotation = 0.5;
  cushion.transform.scale = new Vector3(0.55, 0.4, 1);
  cushion.bezier = [...cushion.bezier!, corner(-14, -10), corner(14, -10), corner(14, 10), corner(-14, 10)]; // + a hole
  cushion.subpathStarts = [0, 4];
  const cb = bakeRings(cushion.bezier, cushion.subpathStarts);
  cushion.controlPoints = cb.controlPoints;
  cushion.ringSplit = cb.ringSplit;
  cushion.contourCounts = cb.contourCounts;
  // a "middle"-extent pillow: exercises the sign-encoded mode + the TRI_START max-distance slot
  // (the join-at-the-middle profile range) GPU==CPU
  const bun = createObjectInstance(ObjectTypeId.Pillow, v2(71.3, 20.7));
  bun.id = "v-bun";
  bun.transform.rotation = 0.2; // off the sample grid: an axis-aligned rim lands sd == 0 EXACTLY on
  bun.transform.scale = new Vector3(0.37, 0.26, 1); // ss2 hi samples, and f32-vs-f64 flips the side
  bun.params.extent = "middle";
  bun.params.inflate = 12;
  return [frame, mesa, cushion, bun];
}

/** A rotated, non-uniformly scaled plateau with a local KEEP mask (one smooth anchor) and a world
 *  CUT mask — exercises both mask spaces, the distance-scale path, and the closed Catmull-Rom bake
 *  in the GPU-vs-CPU drift selftest. */
export function maskedObjects(): ObjectInstance[] {
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(48, 48));
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
 *  object — exercises the affine/shear composition path GPU==CPU in the drift selftest. */
export function nestedGroupLayers(): LayerNode[] {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(20, 0));
  dome.id = "ng-dome";
  dome.transform.rotation = 0.5;
  dome.transform.scale = new Vector3(0.5, 0.8, 1.1);
  const capsule = createObjectInstance(ObjectTypeId.Pipe, v2(-10, 14));
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
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(24, 72));
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
 *  object's own, world-baked through the group affine) GPU==CPU. */
export function scopedMaskGroupLayers(): LayerNode[] {
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(0, 0));
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
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(0, -10)); // straddles x=0: left half kept, reflected right
  dome.id = "mx-dome";
  dome.transform.scale = new Vector3(0.6, 0.7, 1.2);
  const capsule = createObjectInstance(ObjectTypeId.Pipe, v2(-18, 16)); // source (left) side
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
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(-14, -14)); // source quadrant; reflects into all 4
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

/** Perf-stress scene: a grid of mixed objects scaled to the doc — Pillows/Contours carry dense baked
 *  outlines and Pillow's per-fragment boundary integral, i.e. the worst per-pixel eval cost. Object
 *  count grows with size (like a real dense document) so frame cost scales realistically. */
export function stressFieldObjects(size: number, overlap = false): ObjectInstance[] {
  if (overlap) {
    // adversarial: N big objects STACKED over the whole doc — AABB culling can't reject anything,
    // so every fragment pays every object's full SDF (the worst-case fold cost)
    const out: ObjectInstance[] = [];
    const kinds = [ObjectTypeId.Pillow, ObjectTypeId.SurfaceVector, ObjectTypeId.Sphere, ObjectTypeId.Plateau];
    for (let i = 0; i < 16; i++) {
      const o = createObjectInstance(kinds[i % kinds.length]!, v2(size / 2, size / 2));
      o.id = `overlap-${i}`;
      const k = (size / 96) * (0.9 - i * 0.02);
      o.transform.scale = new Vector3(k, k, 1);
      o.transform.rotation = i * 0.4;
      o.opacity = 0.6;
      out.push(o);
    }
    return out;
  }
  const out: ObjectInstance[] = [];
  const cols = Math.max(3, Math.min(8, Math.round(size / 128)));
  const cell = size / cols;
  const kinds = [
    ObjectTypeId.Pillow,
    ObjectTypeId.SurfaceVector,
    ObjectTypeId.Sphere,
    ObjectTypeId.PipeVector,
    ObjectTypeId.Plateau,
    ObjectTypeId.BermVector,
  ];
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      const o = createObjectInstance(kinds[(r * cols + c) % kinds.length]!, v2((c + 0.5) * cell, (r + 0.5) * cell));
      o.id = `stress-${r}-${c}`;
      const k = (cell / 96) * 0.8;
      o.transform.scale = new Vector3(k, k, 1);
      o.transform.rotation = ((r * cols + c) % 7) * 0.31;
      out.push(o);
    }
  }
  return out;
}
