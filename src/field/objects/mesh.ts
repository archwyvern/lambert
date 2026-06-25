import { meshEdges } from "../meshOps";
import { defineObjectType, ObjectTypeId } from "../registry";
import type { ObjectInstance } from "../types";
import { v2 } from "../vec";
import { meshFieldEval, MESH_PARAMS } from "./meshField";

const QUAD_R = 32; // half-extent of a fresh mesh (a 64px plane), matching the plateau footprint
const QUAD_H = 0; // a fresh mesh starts flat on the ground (height 0); sculpt vertices up from there

/** Seed a brand-new mesh as a flat quad: 4 corner vertices, 2 triangles, a uniform starting height. */
function seedQuad(object: ObjectInstance): void {
  object.controlPoints = [v2(-QUAD_R, -QUAD_R), v2(QUAD_R, -QUAD_R), v2(QUAD_R, QUAD_R), v2(-QUAD_R, QUAD_R)];
  const z = [QUAD_H, QUAD_H, QUAD_H, QUAD_H];
  const tris: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
  ];
  object.mesh = { z, tris, edges: meshEdges({ z, tris }) };
}

/**
 * Mesh — a free triangulated height surface. Vertices live in controlPoints (xy) with a parallel z[]
 * and a triangle list in ObjectInstance.mesh; eval (CPU + the shared `shape_meshfield` WGSL) is the
 * barycentric height under each pixel, blended toward Phong by `smoothness`. Dragged from the library
 * as a flat quad, then sculpted by moving vertices and editing heights. Grid/Revolve/Loft/Noise are
 * the same surface with a richer starting seed.
 */
export const Mesh = defineObjectType({
  id: ObjectTypeId.Mesh,
  name: "Mesh",
  category: "Meshes",
  params: { ...MESH_PARAMS },
  controlPoints: { kind: "mesh", default: [] },
  onCreate: seedQuad,
  // record slots: 13 = smoothness; 22 = meshTriStart (vec4 idx), 23 = meshTriCount.
  wgsl: /* wgsl */ `
fn shape_mesh(p: vec2f, base: u32) -> vec2f { return shape_meshfield(p, base); }
`,
  eval: meshFieldEval,
});
