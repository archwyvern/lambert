import { clamp, mix } from "./vec";

export type CombineOp = "max" | "carve";

/** Polynomial smooth max (iq). Deviates from max only where |a-b| < k; bulge k/4 at a=b. */
export function smax(a: number, b: number, k: number): number {
  if (k <= 0) return Math.max(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(a, b, h) + k * h * (1 - h);
}

export function smin(a: number, b: number, k: number): number {
  return -smax(-a, -b, k);
}

/**
 * Fold step. max = smooth-union (shapes clip into each other like solids);
 * carve = smooth-subtract (the smin fillets the groove rim). The op is a property
 * of the shape TYPE, not a per-shape setting.
 */
export function combineHeight(op: CombineOp, H: number, h: number, k: number): number {
  return op === "carve" ? smin(H, H - h, k) : smax(H, h, k);
}

/**
 * Per-shape spatial influence: 1 inside the footprint (sd <= 0), smoothstep falloff to 0
 * over max(blend, 1) px outside. Localizes the smax equality bulge (the fillet skirt) to
 * the shape's neighborhood and doubles as the authored-mask contribution (NX alpha).
 */
export function influence(sdCanvas: number, blend: number): number {
  if (sdCanvas <= 0) return 1;
  const w = Math.max(blend, 1);
  const t = clamp(1 - sdCanvas / w, 0, 1);
  return t * t * (3 - 2 * t);
}
