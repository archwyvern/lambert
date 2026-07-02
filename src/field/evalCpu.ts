import { affineApply } from "./affine";
import { combineHeight, influence, objectCombineOp } from "./combine";
import type { ResolvedObject } from "./flatten";
import { bakeMasks, maskCoverage } from "./maskOps";
import { meshGradients } from "./meshOps";
import { getObjectType } from "./registry";
import { v2 } from "./vec";

export interface FieldResult {
  width: number;
  height: number;
  /** Height in px, row-major. */
  heightMap: Float32Array;
  /** Authored mask 0..1 (NX alpha), row-major. */
  mask: Float32Array;
}

/** Evaluate the ordered object fold at every pixel center. The CPU reference implementation. Takes
 *  the flattened, world-resolved object list (see flattenLayers) — group composition + visibility
 *  are already applied. */
export function evaluateField(resolved: ResolvedObject[], width: number, height: number): FieldResult {
  const heightMap = new Float32Array(width * height);
  const mask = new Float32Array(width * height);
  const items = resolved.map((rs) => {
    const type = getObjectType(rs.object.typeId);
    return {
      rs,
      type,
      // op (max/carve/replace): shared with pack.ts so the CPU and GPU folds agree.
      op: objectCombineOp(rs.object.params, type.defaultCombine),
      // fold-contribution weight (mirrors the SLOT_OPACITY clamp in pack.ts)
      alpha: Math.min(1, Math.max(0, rs.object.opacity ?? 1)),
      // attach the transient per-vertex gradient a mesh needs for its smoothness pass
      s: rs.object.mesh
        ? { ...rs.object, mesh: { ...rs.object.mesh, grad: meshGradients(rs.object.controlPoints, rs.object.mesh.z, rs.object.mesh.tris) } }
        : rs.object,
      baked: rs.masks.length > 0 ? bakeMasks(rs.masks) : [],
    };
  });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = v2(x + 0.5, y + 0.5);
      let H = 0;
      let M = 0;
      let covered = false; // has any object hard-covered this pixel yet?
      for (const { rs, type, op, s, baked, alpha } of items) {
        const sample = type.eval(affineApply(rs.invAffine, p), s);
        const sd = sample.sd * rs.scaleHint;
        // per-object opacity scales the whole contribution: the mask influence AND the height step below
        let inf = influence(sd) * alpha;
        if (rs.masks.length > 0) inf *= maskCoverage(rs.masks, baked, rs.invAffine, rs.scaleHint, p);
        if (inf <= 0) continue;
        const h = rs.elevationZ + sample.height * rs.tallnessZ; // composed elevation + extrude
        // the FIRST object (a non-carve "max" object) to cover a pixel SETS the surface, so it can go
        // below the ground plane — negative Z is allowed. Later overlapping objects, and carve objects
        // (which subtract from the ground), always combine.
        const combined = !covered && op !== "carve" ? h : combineHeight(op, H, h);
        // mask = footprint COVERAGE (AA edge + trim masks), not height change — so a flat region (z=0,
        // or the low end of a slope) still writes its normal instead of vanishing.
        M = Math.max(M, inf);
        // Height is a HARD step at the footprint boundary (inside = full contribution). A vertical
        // wall must stay a wall in the height field, not melt into a 1px influence ramp — otherwise
        // deriveNormals' minmod sees a slope on both sides of the edge and can't flatten it. The
        // edge softening lives entirely in the mask above. Opacity lerps the step toward the
        // accumulated surface (0.5 = half effect).
        if (sd < 0) {
          H = H + (combined - H) * alpha;
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
