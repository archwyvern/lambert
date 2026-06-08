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
