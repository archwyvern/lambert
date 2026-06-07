import { Vec2, v2 } from "./vec";

/** xy scale the footprint; z scales the height contribution (tallness). */
export interface Scale3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform2D {
  pos: Vec2;
  rotation: number; // radians
  scale: Scale3;
}

export const identityTransform = (): Transform2D => ({
  pos: v2(0, 0),
  rotation: 0,
  scale: { x: 1, y: 1, z: 1 },
});

/** Map a canvas-space point into shape-local space (inverse of the instance transform). */
export function toLocal(t: Transform2D, p: Vec2): Vec2 {
  const dx = p.x - t.pos.x;
  const dy = p.y - t.pos.y;
  const c = Math.cos(-t.rotation);
  const s = Math.sin(-t.rotation);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return v2(rx / t.scale.x, ry / t.scale.y);
}

/**
 * Approximate multiplier converting shape-local distances to canvas px.
 * Exact for uniform scale; average of |sx|,|sy| otherwise (documented approximation).
 */
export function distanceScale(t: Transform2D): number {
  return (Math.abs(t.scale.x) + Math.abs(t.scale.y)) / 2;
}
