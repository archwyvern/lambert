import { clamp } from "./vec";

export type ProfileKind = "round" | "linear" | "cove" | "smooth";

// ORDER IS A GPU CONTRACT. pack.ts converts a profile enum to its index here (`PROFILE_KINDS.indexOf`),
// and `apply_profile` in gpu/wgsl.ts hardcodes those indices (case 0=round, 1=linear, 2=cove,
// default=smooth) — plus some objects pack a literal `1u` for "linear". Reordering this array silently
// re-indexes every profile on the GPU. Append new kinds at the END and add a matching `case` in the WGSL.
export const PROFILE_KINDS: ProfileKind[] = ["round", "linear", "cove", "smooth"];

/**
 * Map distance-inside-the-footprint to a 0..1 height factor over slopeWidth px.
 * linear = straight ramp (a chamfer), smooth = hermite ease, round = convex
 * quarter-round (bullnose: vertical at rim, flat on top), cove = concave quarter-round.
 */
export function applyProfile(kind: ProfileKind, inside: number, slopeWidth: number): number {
  if (slopeWidth <= 0) return inside > 0 ? 1 : 0;
  const t = clamp(inside / slopeWidth, 0, 1);
  switch (kind) {
    case "round":
      return Math.sqrt(t * (2 - t));
    case "linear":
      return t;
    case "cove":
      return 1 - Math.sqrt(1 - t * t);
    case "smooth":
      return t * t * (3 - 2 * t);
  }
}
