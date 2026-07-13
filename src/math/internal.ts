// Package-internal helpers (not part of the public API).

export const clampScalar = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Truncate toward zero — matches a C# `(int)` cast, used to keep integer vectors integral. */
export const toInt = (v: number): number => Math.trunc(v);

/**
 * Engine comparison epsilon — mirrors C# `Approx.Epsilon` (1e-5, Godot's `CMP_EPSILON`).
 * Used as the degenerate/parallel guard threshold inside geometry algorithms. Distinct from
 * the `1e-6` default used by the value-type `isEqualApprox` methods.
 */
export const APPROX_EPSILON = 1e-5;

/** Default tolerance for the `isEqualApprox` family across the value types. */
export const EPSILON = 1e-6;

/** Linear interpolation between `a` and `b`. */
export const lerpScalar = (a: number, b: number, weight: number): number => a + (b - a) * weight;
