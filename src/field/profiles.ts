import { clamp } from "./vec";

export type ProfileKind = "round" | "linear" | "cove" | "smooth";

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
