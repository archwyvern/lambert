import { defineObjectType, ObjectTypeId } from "../registry";
import type { ObjectInstance } from "../types";
import { gridMesh, meshFieldEval, MESH_PARAMS } from "./meshField";

const N = 4; // (N+1)² = 5×5 vertices
const R = 32;

/** Grid — a regular subdivided mesh patch (structured, vs Mesh's free quad). Seeds flat on the
 *  ground; sculpt the grid vertices up/down. Shares the mesh-field eval/WGSL. */
export const Grid = defineObjectType({
  id: ObjectTypeId.Grid,
  name: "Grid",
  category: "Meshes",
  params: { ...MESH_PARAMS },
  controlPoints: { kind: "mesh", default: [] },
  onCreate(o: ObjectInstance) {
    Object.assign(o, gridMesh(N, R, () => 0));
  },
  wgsl: /* wgsl */ `
fn shape_grid(p: vec2f, base: u32) -> vec2f { return shape_meshfield(p, base); }
`,
  eval: meshFieldEval,
});
