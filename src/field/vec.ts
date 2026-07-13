import { Vector2 } from "../math";

/** Terse constructor for a carapace {@link Vector2} (the 2D vector type used throughout). */
export const v2 = (x: number, y: number): Vector2 => new Vector2(x, y);

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
