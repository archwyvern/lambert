import { clamp } from "./vec";

export type CombineOp = "max" | "carve" | "replace" | "adjust";

/** Fold-op index packed into the GPU record (must match `combine_height` in gpu/wgsl.ts). */
export const COMBINE_OP_INDEX: Record<CombineOp, number> = { max: 0, carve: 1, replace: 2, adjust: 3 };

/**
 * Fold step. max = objects clip into each other like solids; carve subtracts; replace overwrites the
 * accumulated height with this object's (a stencil — the object's surface wins outright inside its
 * footprint, ignoring what's beneath). Usually a property of the object TYPE (defaultCombine), overridable
 * per-instance by types with an `invert` param — see objectCombineOp.
 */
export function combineHeight(op: CombineOp, H: number, h: number): number {
  if (op === "carve") return Math.min(H, H - h);
  if (op === "replace") return h;
  if (op === "adjust") return H; // adjustment layers transform H in their own fold branch, not here
  return Math.max(H, h);
}

/** Resolve an object's fold op: an `invert` enum param ("raise"|"carve"|"replace") drives it
 *  per-instance (Pipe/Berm); otherwise the type's defaultCombine (or max). The single source of truth
 *  for both the CPU fold (evalCpu) and the GPU pack (pack.ts), so they never diverge. */
export function objectCombineOp(params: Record<string, unknown>, defaultCombine: CombineOp | undefined): CombineOp {
  if ("invert" in params) {
    if (params.invert === "carve") return "carve";
    if (params.invert === "replace") return "replace";
    return "max"; // "raise"
  }
  return defaultCombine ?? "max";
}

/**
 * Per-object spatial influence = box-filter edge coverage CENTERED on the footprint boundary:
 * 1 a half-pixel inside, ~0.5 at the edge, 0 a half-pixel outside. Smoothstep falloff over that
 * ±0.5px window so the effect (and the NX mask) doesn't bleed a full pixel past the edge — an
 * axis-aligned edge on a pixel boundary lands pixel-sharp. Doubles as the authored-mask (NX alpha).
 */
export function influence(sdCanvas: number): number {
  const t = clamp(0.5 - sdCanvas, 0, 1);
  return t * t * (3 - 2 * t);
}
