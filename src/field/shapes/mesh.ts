import { defineShapeType } from "../registry";
import { sdSegment } from "../sdf";
import { triBary } from "../tri";

/**
 * Mesh plane: a free triangulated height surface. Vertices live in controlPoints (xy) with a
 * parallel z[] (height) and a triangle list in ShapeInstance.mesh. Height at a pixel is the
 * barycentric interpolation across the triangle under it; the `smoothness` param (0..1) blends
 * that flat interpolation toward Phong tessellation (each vertex's tangent plane, from the
 * per-vertex gradient mesh.grad) so the faceted surface rounds off. Normals derive from the
 * resulting height field like every other shape. Created by converting a rings shape, never
 * dragged from the library.
 */
export const Mesh = defineShapeType({
  id: "mesh",
  name: "Mesh",
  params: { smoothness: { type: "px", default: 0, min: 0, max: 1, step: 0.05 } },
  controlPoints: { kind: "mesh", default: [] },
  libraryHidden: true, // created by conversion, never dragged from the palette
  // record slots: 13 = smoothness; 22 = meshTriStart (vec4 idx), 23 = meshTriCount. meshTris is
  // 2 vec4 per vertex (pos x,y,height,gradX then gradY,_,_,_), 6 vec4 per triangle.
  wgsl: /* wgsl */ `
fn shape_mesh(p: vec2f, base: u32) -> vec2f {
  let sm = rec(base, 13u);
  let triStart = u32(rec(base, 22u));
  let triCount = u32(rec(base, 23u));
  for (var t = 0u; t < triCount; t = t + 1u) {
    let o = triStart + t * 6u;
    let a = meshTris[o];
    let b = meshTris[o + 2u];
    let c = meshTris[o + 4u];
    let det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (abs(det) < 1e-9) { continue; }
    let uu = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
    let vv = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
    if (uu >= -1e-4 && vv >= -1e-4 && uu + vv <= 1.0001) {
      let ww = 1.0 - uu - vv;
      let hL = ww * a.z + uu * b.z + vv * c.z;
      if (sm <= 0.0) { return vec2f(hL, -1.0); }
      // Phong tessellation: each vertex's tangent-plane height at p (gradX = .w, gradY = next .x)
      let pa = a.z + a.w * (p.x - a.x) + meshTris[o + 1u].x * (p.y - a.y);
      let pb = b.z + b.w * (p.x - b.x) + meshTris[o + 3u].x * (p.y - b.y);
      let pc = c.z + c.w * (p.x - c.x) + meshTris[o + 5u].x * (p.y - c.y);
      let hP = ww * pa + uu * pb + vv * pc;
      return vec2f(hL + sm * (hP - hL), -1.0);
    }
  }
  var d = 1e9;
  for (var t = 0u; t < triCount; t = t + 1u) {
    let o = triStart + t * 6u;
    let a = meshTris[o].xy;
    let b = meshTris[o + 2u].xy;
    let c = meshTris[o + 4u].xy;
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
    const sm = typeof shape.params.smoothness === "number" ? shape.params.smoothness : 0;
    for (const [a, b, c] of m.tris) {
      const bary = triBary(p, cps[a]!, cps[b]!, cps[c]!);
      if (bary === null) continue;
      const { u, v } = bary;
      const w = 1 - u - v;
      const hL = w * m.z[a]! + u * m.z[b]! + v * m.z[c]!;
      if (sm <= 0 || !m.grad) return { height: hL, sd: -1 };
      const plane = (i: number): number => {
        const g = m.grad![i]!;
        return m.z[i]! + g[0] * (p.x - cps[i]!.x) + g[1] * (p.y - cps[i]!.y);
      };
      const hP = w * plane(a) + u * plane(b) + v * plane(c);
      return { height: hL + sm * (hP - hL), sd: -1 };
    }
    // outside every triangle: distance to the nearest edge = distance to the mesh outline
    let d = Infinity;
    for (const [a, b, c] of m.tris) {
      d = Math.min(d, sdSegment(p, cps[a]!, cps[b]!), sdSegment(p, cps[b]!, cps[c]!), sdSegment(p, cps[c]!, cps[a]!));
    }
    return { height: 0, sd: d };
  },
});
