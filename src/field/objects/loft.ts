import { meshEdges } from "../meshOps";
import { defineObjectType, ObjectTypeId } from "../registry";
import type { ObjectInstance } from "../types";
import { v2 } from "../vec";
import { meshFieldEval, MESH_PARAMS } from "./meshField";

const SEG = 8; // segments along the strip
const HALF_LEN = 32; // extent along x
const HALF_W = 16; // rail separation (rails at y = ±HALF_W)
const H = 16; // hump height

/** Loft — a quad strip lofted between two rails. Seeds a humped ribbon (two parallel rails bridged
 *  by cross-quads); move the rail vertices to reshape. Shares the mesh-field eval/WGSL. */
export const Loft = defineObjectType({
  id: ObjectTypeId.Loft,
  name: "Loft",
  category: "Meshes",
  params: { ...MESH_PARAMS },
  controlPoints: { kind: "mesh", default: [] },
  onCreate(o: ObjectInstance) {
    const cps = [];
    const z: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const x = -HALF_LEN + 2 * HALF_LEN * t;
      const h = H * Math.sin(t * Math.PI); // hump along the strip
      cps.push(v2(x, -HALF_W));
      z.push(h);
      cps.push(v2(x, HALF_W));
      z.push(h);
    }
    const tris: [number, number, number][] = [];
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = i * 2 + 2;
      const d = i * 2 + 3;
      tris.push([a, b, d]);
      tris.push([a, d, c]);
    }
    o.controlPoints = cps;
    o.mesh = { z, tris, edges: meshEdges({ z, tris }) };
  },
  wgsl: /* wgsl */ `
fn shape_loft(p: vec2f, base: u32) -> vec2f { return shape_meshfield(p, base); }
`,
  eval: meshFieldEval,
});
