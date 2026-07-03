import { affineInvert, affineApply } from "./affine";
import { combineHeight, influence, objectCombineOp } from "./combine";
import type { ResolvedObject } from "./flatten";
import { bakeMasks, maskCoverage } from "./maskOps";
import { meshGradients } from "./meshOps";
import { localBounds } from "./objectBounds";
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
      // world footprint AABB (influence-padded) — the same cull the GPU fold uses (pack.ts): outside
      // it the contribution is exactly zero, so skipping changes nothing but the loop cost
      aabb: worldAabb(rs),
    };
  });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = v2(x + 0.5, y + 0.5);
      let H = 0;
      let M = 0;
      let covered = false; // has any object hard-covered this pixel yet?
      for (const { rs, type, op, s, baked, alpha, aabb } of items) {
        if (p.x < aabb.minX || p.x > aabb.maxX || p.y < aabb.minY || p.y > aabb.maxY) continue;
        const sample = type.eval(affineApply(rs.invAffine, p), s);
        const sd = sample.sd * rs.scaleHint;
        // per-object opacity scales the whole contribution: the mask influence AND the height step
        // below. Edge coverage: AA objects get the box-filter ramp; the default is a HARD step at
        // sd < 0 (crisp sprite silhouettes) — WGSL fold_at mirrors this.
        let inf = (rs.object.aa ? influence(sd) : sd < 0 ? 1 : 0) * alpha;
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

/** World footprint AABB via the forward affine (inverse of invAffine), padded for the AA ramp —
 *  kept in lockstep with the identical computation in gpu/pack.ts. */
function worldAabb(rs: ResolvedObject): { minX: number; minY: number; maxX: number; maxY: number } {
  const inv = rs.invAffine;
  const fwd = affineInvert(inv); // world <- local (invAffine is world -> local)
  const b = localBounds(rs.object);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lx, ly] of [[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y]] as const) {
    const wpt = affineApply(fwd, v2(lx, ly));
    minX = Math.min(minX, wpt.x);
    minY = Math.min(minY, wpt.y);
    maxX = Math.max(maxX, wpt.x);
    maxY = Math.max(maxY, wpt.y);
  }
  return { minX: minX - 1.5, minY: minY - 1.5, maxX: maxX + 1.5, maxY: maxY + 1.5 };
}
