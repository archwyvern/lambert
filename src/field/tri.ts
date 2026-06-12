import { Vec2 } from "./vec";

/**
 * Barycentric height of p inside triangle abc with corner heights ha/hb/hc; null if p is
 * outside. eps is tolerant on shared edges so adjacent triangles always cover the seam.
 */
export function triBaryHeight(
  p: Vec2,
  a: Vec2,
  b: Vec2,
  c: Vec2,
  ha: number,
  hb: number,
  hc: number,
): number | null {
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(det) < 1e-9) return null;
  const u = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
  const v = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
  const eps = -1e-4;
  if (u < eps || v < eps || u + v > 1 + 1e-4) return null;
  return ha + u * (hb - ha) + v * (hc - ha);
}

/** Barycentric coords (u,v) of p in triangle abc, or null if outside (tolerant on shared edges). */
export function triBary(p: Vec2, a: Vec2, b: Vec2, c: Vec2): { u: number; v: number } | null {
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(det) < 1e-9) return null;
  const u = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
  const v = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
  if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) return null;
  return { u, v };
}
