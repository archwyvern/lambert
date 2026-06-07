import { clamp, mix } from "./vec";

export type CombineOp = "raise" | "add" | "carve";

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
 * Fold step. raise = smooth-union, add = stack on whatever is below (detail follows
 * curvature), carve = smooth-subtract (the smin fillets the groove rim).
 */
export function combineHeight(op: CombineOp, H: number, h: number, k: number): number {
  switch (op) {
    case "raise":
      return smax(H, h, k);
    case "add":
      return H + h;
    case "carve":
      return smin(H, H - h, k);
  }
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
