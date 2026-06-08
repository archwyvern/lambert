import { defineShapeType } from "../registry";
import { sdSegment } from "../sdf";
import { triBaryHeight } from "../tri";

/**
 * Mesh plane: a free triangulated height surface. Vertices live in controlPoints (xy) with
 * a parallel z[] (height) and a triangle list, in ShapeInstance.mesh. Height at a pixel is
 * the barycentric interpolation across the triangle under it; normals derive from that
 * surface like every other shape. Created by converting a shape (see meshConvert), never
 * dragged from the library — so it carries no WGSL yet and renders on the CPU path only.
 */
export const Mesh = defineShapeType({
  id: "mesh",
  name: "Mesh",
  params: {},
  controlPoints: { kind: "mesh", default: [] },
  libraryHidden: true, // created by conversion, never dragged from the palette
  // record slots: 22 = meshTriStart (vec4 index), 23 = meshTriCount; verts from meshTris
  wgsl: /* wgsl */ `
fn shape_mesh(p: vec2f, base: u32) -> vec2f {
  let triStart = u32(rec(base, 22u));
  let triCount = u32(rec(base, 23u));
  for (var t = 0u; t < triCount; t = t + 1u) {
    let o = triStart + t * 3u;
    let a = meshTris[o];
    let b = meshTris[o + 1u];
    let c = meshTris[o + 2u];
    let det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (abs(det) < 1e-9) { continue; }
    let uu = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
    let vv = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
    if (uu >= -1e-4 && vv >= -1e-4 && uu + vv <= 1.0001) {
      return vec2f(a.z + uu * (b.z - a.z) + vv * (c.z - a.z), -1.0);
    }
  }
  var d = 1e9;
  for (var t = 0u; t < triCount; t = t + 1u) {
    let o = triStart + t * 3u;
    let a = meshTris[o].xy;
    let b = meshTris[o + 1u].xy;
    let c = meshTris[o + 2u].xy;
    d = min(d, sd_segment(p, a, b));
    d = min(d, sd_segment(p, b, c));
    d = min(d, sd_segment(p, c, a));
  }
  return vec2f(0.0, d);
}
`,
  eval(p, shape) {
    const m = shape.mesh;
    const cps = shape.controlPoints;
    if (!m || m.tris.length === 0) return { height: 0, sd: 1e9 };
    for (const [a, b, c] of m.tris) {
      const h = triBaryHeight(p, cps[a]!, cps[b]!, cps[c]!, m.z[a]!, m.z[b]!, m.z[c]!);
      if (h !== null) return { height: h, sd: -1 };
    }
    // outside every triangle: distance to the nearest edge = distance to the mesh outline
    let d = Infinity;
    for (const [a, b, c] of m.tris) {
      d = Math.min(d, sdSegment(p, cps[a]!, cps[b]!), sdSegment(p, cps[b]!, cps[c]!), sdSegment(p, cps[c]!, cps[a]!));
    }
    return { height: 0, sd: d };
  },
});
