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

/** Smoothness floor: second differences below this are float dust — both sides count as equally
 *  smooth. Heights are in pixels; real discontinuities are orders of magnitude above this. */
const SMOOTH_EPS = 1e-4;
/** Smoothness-dominance band (on (sb-sf)/(sb+sf), i.e. |d|): below D0 the sides are a tie
 *  (minmod); above D1 the smoother side fully owns the gradient; between them a linear blend.
 *  D0 = 1/3 is a 2:1 second-difference ratio; D1 = 0.6 is 4:1. */
const DOM_LO = 1 / 3;
const DOM_HI = 0.6;
/** Absolute engagement gate on the rougher side's second difference (px of height): below STEP_LO
 *  the stencil holds no real discontinuity and pure minmod applies — this keeps the operator inert
 *  on smooth curvature (sphere/berm/pipe interiors), where the dominance RATIO would otherwise
 *  amplify sub-tolerance GPU-vs-CPU height noise into visible normal drift. Real seams and mask
 *  carves step >= ~1px, far above STEP_HI. */
const STEP_LO = 0.25;
const STEP_HI = 1.0;

/**
 * Smoothness-guided one-sided gradient over the 5-sample stencil hm2..hp2. Each side's second
 * difference measures whether its stencil crosses a surface DISCONTINUITY — a footprint
 * silhouette, a trim-mask carve, or the small step where two plates meet. The clearly smoother
 * side's one-sided slope takes over, so a sloped surface keeps its true normal right up to any
 * edge; plain minmod (both sides comparably smooth: interiors, tent apexes, symmetric curvature)
 * remains the base and keeps the classic behaviour — walls stay invisible because the surface
 * side of a cliff is the smooth side and it is flat.
 *
 * The takeover is a CONTINUOUS blend on the smoothness dominance, never a hard select: the
 * operator must be continuous in its inputs or f32 (GPU) vs f64 (CPU) dust flips a branch on
 * near-tie stencils and the two pipelines derive visibly different normals (selftest parity).
 *
 * Without this, minmod mangled edge-adjacent texels: a step's one-sided diff either cancelled the
 * true slope to flat (opposite sign — the 2px seam between intersecting plates, the dark fringe
 * inside mask edges) or masqueraded as the surface slope (same sign, smaller).
 */
function sideGrad(hm2: number, hm1: number, h0: number, hp1: number, hp2: number): number {
  const fwd = hp1 - h0;
  const bwd = h0 - hm1;
  const sf = Math.max(Math.abs(hp2 - 2 * hp1 + h0), SMOOTH_EPS);
  const sb = Math.max(Math.abs(h0 - 2 * hm1 + hm2), SMOOTH_EPS);
  const d = (sb - sf) / (sb + sf); // >0: forward side smoother
  const dom = Math.min(1, Math.max(0, (Math.abs(d) - DOM_LO) / (DOM_HI - DOM_LO)));
  const gate = Math.min(1, Math.max(0, (Math.max(sf, sb) - STEP_LO) / (STEP_HI - STEP_LO)));
  const t = dom * gate;
  const side = d > 0 ? fwd : bwd;
  const base = minmod(fwd, bwd);
  return base + (side - base) * t;
}

/**
 * Edge-preserving normals from a height field (smoothness-guided one-sided differences — see
 * {@link sideGrad}), edge-clamped. Image space: x right, y down, z out —
 * n = normalize(-dH/dx, -dH/dy, 1). slopeScale multiplies the gradients (used by supersampled
 * rendering, where the canvas is scaled up but heights are not). Packed xyz triplets, row-major.
 */
export function deriveNormals(
  heightMap: Float32Array,
  width: number,
  height: number,
  slopeScale = 1,
): Float32Array {
  const out = new Float32Array(width * height * 3);
  const at = (x: number, y: number): number =>
    heightMap[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = sideGrad(at(x - 2, y), at(x - 1, y), at(x, y), at(x + 1, y), at(x + 2, y)) * slopeScale;
      const dy = sideGrad(at(x, y - 2), at(x, y - 1), at(x, y), at(x, y + 1), at(x, y + 2)) * slopeScale;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 3;
      out[i] = -dx * inv;
      out[i + 1] = -dy * inv;
      out[i + 2] = inv;
    }
  }
  return out;
}
