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
 * Per-shape spatial influence = box-filter edge coverage CENTERED on the footprint boundary:
 * 1 a half-pixel inside, ~0.5 at the edge, 0 a half-pixel outside. Smoothstep falloff over that
 * ±0.5px window so the effect (and the NX mask) doesn't bleed a full pixel past the edge — an
 * axis-aligned edge on a pixel boundary lands pixel-sharp. Doubles as the authored-mask (NX alpha).
 */
export function influence(sdCanvas: number): number {
  const t = clamp(0.5 - sdCanvas, 0, 1);
  return t * t * (3 - 2 * t);
}
