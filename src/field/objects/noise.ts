import { defineObjectType, ObjectTypeId } from "../registry";
import type { ObjectInstance } from "../types";
import { gridMesh, meshFieldEval, MESH_PARAMS } from "./meshField";

const N = 12; // fine grid so the noise reads
const R = 32;
const AMP = 14; // px height of the noise field

/** Deterministic 2-octave value noise in [0,1] (sin-hash, smoothstep interp; no RNG so a fresh
 *  Noise object is always the same seed — edit it afterwards). */
function valueNoise(x: number, y: number): number {
  const hash = (i: number, j: number): number => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (a: number, b: number, t: number): number => a + (b - a) * (t * t * (3 - 2 * t));
  const octave = (freq: number): number => {
    const gx = x * freq;
    const gy = y * freq;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const a = smooth(hash(ix, iy), hash(ix + 1, iy), fx);
    const b = smooth(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx);
    return smooth(a, b, fy);
  };
  return 0.65 * octave(0.09) + 0.35 * octave(0.22);
}

/** Noise — a subdivided grid seeded with fractal value noise (organic ground / rock / fabric), then
 *  editable like any mesh. Shares the mesh-field eval/WGSL. */
export const Noise = defineObjectType({
  id: ObjectTypeId.Noise,
  name: "Noise",
  category: "Meshes",
  params: { ...MESH_PARAMS },
  controlPoints: { kind: "mesh", default: [] },
  onCreate(o: ObjectInstance) {
    Object.assign(o, gridMesh(N, R, (x, y) => AMP * valueNoise(x, y)));
  },
  wgsl: /* wgsl */ `
fn shape_noise(p: vec2f, base: u32) -> vec2f { return shape_meshfield(p, base); }
`,
  eval: meshFieldEval,
});
