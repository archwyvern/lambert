import { clamp } from "./vec";

/**
 * minmod limiter of the two one-sided slopes. This is what makes a vertical wall vanish from the
 * normal map the way an orthographic 3D bake does, instead of smearing into a 1px ramp:
 *  - smooth surface (both one-sided diffs agree in sign) -> the true local slope (rounded objects
 *    and ramps are unchanged from a central difference)
 *  - peak / apex (diffs disagree in sign) -> 0, i.e. up (correct — the tangent there is flat)
 *  - cliff (one side flat, the other a wall) -> the flat side wins -> 0, so the edge is invisible.
 * A plain central difference can't tell a cliff from a slope; it always averages the wall in.
 */
function minmod(a: number, b: number): number {
  if (a * b <= 0) return 0;
  return Math.abs(a) < Math.abs(b) ? a : b;
}

/** A neighbour with coverage at/below this is "carved" (masked-out / off-footprint): its height is
 *  the trim floor, not real surface, so it must not enter a visible texel's gradient. */
const COVER_EPS = 1e-3;

/**
 * One coverage-aware axis gradient. `fwd`/`bwd` are the forward/backward one-sided height diffs and
 * `fwdCov`/`bwdCov` whether each neighbour is covered. Both covered → minmod (edge-preserving as
 * before). One side carved → use the covered side's slope alone, so a genuine surface slope survives
 * up to a trim/silhouette edge instead of minmod cancelling it against the carve cliff (the fringe).
 * Both carved → 0 (a 1px covered sliver has no defined slope).
 */
function coverGrad(fwd: number, bwd: number, fwdCov: boolean, bwdCov: boolean): number {
  if (fwdCov && bwdCov) return minmod(fwd, bwd);
  if (fwdCov) return fwd;
  if (bwdCov) return bwd;
  return 0;
}

/**
 * Edge-preserving normals from a height field (minmod of one-sided differences), edge-clamped.
 * Image space: x right, y down, z out — n = normalize(-dH/dx, -dH/dy, 1).
 * slopeScale multiplies the gradients (used by supersampled rendering, where the canvas is
 * scaled up but heights are not). Output is packed xyz triplets, row-major.
 *
 * `mask` (the footprint+trim coverage, same layout) makes the gradient coverage-aware: a masked-out
 * neighbour is excluded so a trimmed/silhouetted edge of a SLOPED surface keeps its true normal
 * instead of a flattened fringe (minmod otherwise cancels the real slope against the carve cliff).
 * Omitted = plain minmod (no coverage data). Walls stay flat either way — their covered side is flat.
 */
export function deriveNormals(
  heightMap: Float32Array,
  width: number,
  height: number,
  slopeScale = 1,
  mask?: Float32Array,
): Float32Array {
  const out = new Float32Array(width * height * 3);
  const at = (x: number, y: number): number =>
    heightMap[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)]!;
  const covered = (x: number, y: number): boolean =>
    mask === undefined || mask[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)]! > COVER_EPS;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = at(x, y);
      const dx = coverGrad(at(x + 1, y) - c, c - at(x - 1, y), covered(x + 1, y), covered(x - 1, y)) * slopeScale;
      const dy = coverGrad(at(x, y + 1) - c, c - at(x, y - 1), covered(x, y + 1), covered(x, y - 1)) * slopeScale;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 3;
      out[i] = -dx * inv;
      out[i + 1] = -dy * inv;
      out[i + 2] = inv;
    }
  }
  return out;
}
