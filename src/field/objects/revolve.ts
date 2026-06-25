import { defineObjectType, ObjectTypeId } from "../registry";
import type { ObjectInstance } from "../types";
import { gridMesh, meshFieldEval, MESH_PARAMS } from "./meshField";

const N = 10;
const R = 32;
const H = 22; // dome peak height

/** Revolve — a radially-symmetric surface (a profile revolved about the centre). Seeds a domed
 *  profile (peak at the centre, falling to the rim); edit the vertices to reshape the section.
 *  Shares the mesh-field eval/WGSL. */
export const Revolve = defineObjectType({
  id: ObjectTypeId.Revolve,
  name: "Revolve",
  category: "Meshes",
  params: { ...MESH_PARAMS },
  controlPoints: { kind: "mesh", default: [] },
  onCreate(o: ObjectInstance) {
    Object.assign(
      o,
      gridMesh(N, R, (x, y) => {
        const t = Math.min(1, Math.hypot(x, y) / R);
        return H * Math.cos((t * Math.PI) / 2); // revolved dome profile
      }),
    );
  },
  wgsl: /* wgsl */ `
fn shape_revolve(p: vec2f, base: u32) -> vec2f { return shape_meshfield(p, base); }
`,
  eval: meshFieldEval,
});
