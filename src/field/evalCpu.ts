import { affineApply } from "./affine";
import { combineHeight, influence } from "./combine";
import type { ResolvedShape } from "./flatten";
import { bakeMasks, maskCoverage } from "./maskOps";
import { meshGradients } from "./meshOps";
import { getShapeType } from "./registry";
import { v2 } from "./vec";

export interface FieldResult {
  width: number;
  height: number;
  /** Height in px, row-major. */
  heightMap: Float32Array;
  /** Authored mask 0..1 (NX alpha), row-major. */
  mask: Float32Array;
}

/** Evaluate the ordered shape fold at every pixel center. The CPU reference implementation. Takes
 *  the flattened, world-resolved shape list (see flattenLayers) — group composition + visibility
 *  are already applied. */
export function evaluateField(resolved: ResolvedShape[], width: number, height: number): FieldResult {
  const heightMap = new Float32Array(width * height);
  const mask = new Float32Array(width * height);
  const items = resolved.map((rs) => ({
    rs,
    type: getShapeType(rs.shape.typeId),
    op: getShapeType(rs.shape.typeId).defaultCombine ?? ("max" as const),
    // attach the transient per-vertex gradient a mesh needs for its smoothness pass
    s: rs.shape.mesh
      ? { ...rs.shape, mesh: { ...rs.shape.mesh, grad: meshGradients(rs.shape.controlPoints, rs.shape.mesh.z, rs.shape.mesh.tris) } }
      : rs.shape,
    baked: rs.masks.length > 0 ? bakeMasks(rs.masks) : [],
  }));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = v2(x + 0.5, y + 0.5);
      let H = 0;
      let M = 0;
      let covered = false; // has any shape hard-covered this pixel yet?
      for (const { rs, type, op, s, baked } of items) {
        const sample = type.eval(affineApply(rs.invAffine, p), s);
        const sd = sample.sd * rs.scaleHint;
        let inf = influence(sd);
        if (rs.masks.length > 0) inf *= maskCoverage(rs.masks, baked, rs.invAffine, rs.scaleHint, p);
        if (inf <= 0) continue;
        const h = rs.elevationZ + sample.height * rs.tallnessZ; // composed elevation + extrude
        // the FIRST shape (a non-carve "max" shape) to cover a pixel SETS the surface, so it can go
        // below the ground plane — negative Z is allowed. Later overlapping shapes, and carve shapes
        // (which subtract from the ground), always combine.
        const combined = !covered && op !== "carve" ? h : combineHeight(op, H, h);
        // mask = footprint COVERAGE (AA edge + trim masks), not height change — so a flat region (z=0,
        // or the low end of a slope) still writes its normal instead of vanishing.
        M = Math.max(M, inf);
        // Height is a HARD step at the footprint boundary (inside = full contribution). A vertical
        // wall must stay a wall in the height field, not melt into a 1px influence ramp — otherwise
        // deriveNormals' minmod sees a slope on both sides of the edge and can't flatten it. The
        // edge softening lives entirely in the mask above.
        if (sd < 0) {
          H = combined;
          covered = true;
        }
      }
      const i = y * width + x;
      heightMap[i] = H;
      mask[i] = M;
    }
  }
  return { width, height, heightMap, mask };
}
