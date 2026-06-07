import { clamp } from "./vec";

export type CombineOp = "max" | "carve";

/**
 * Fold step. max = shapes clip into each other like solids; carve subtracts.
 * The op is a property of the shape TYPE, not a per-shape setting.
 */
export function combineHeight(op: CombineOp, H: number, h: number): number {
  return op === "carve" ? Math.min(H, H - h) : Math.max(H, h);
}

/**
 * Per-shape spatial influence: 1 inside the footprint (sd <= 0), smoothstep falloff to 0
 * over 1 px outside — the anti-aliased edge, doubling as the authored-mask contribution
 * (NX alpha).
 */
export function influence(sdCanvas: number): number {
  if (sdCanvas <= 0) return 1;
  const t = clamp(1 - sdCanvas, 0, 1);
  return t * t * (3 - 2 * t);
}
