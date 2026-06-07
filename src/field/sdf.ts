import { Vec2, clamp, dot, dot2, len, scale, sub, v2 } from "./vec";

/** Unsigned distance from p to segment ab. */
export function sdSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const pa = sub(p, a);
  const ba = sub(b, a);
  const h = clamp(dot(pa, ba) / dot2(ba), 0, 1);
  return len(sub(pa, scale(ba, h)));
}

/** Exact signed distance to a simple polygon (negative inside). Winding-independent. */
export function sdPolygon(p: Vec2, v: Vec2[]): number {
  const n = v.length;
  let d = dot2(sub(p, v[0]!));
  let s = 1.0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = v[i]!;
    const vj = v[j]!;
    const e = sub(vj, vi);
    const w = sub(p, vi);
    const t = clamp(dot(w, e) / dot2(e), 0, 1);
    d = Math.min(d, dot2(sub(w, scale(e, t))));
    const c0 = p.y >= vi.y;
    const c1 = p.y < vj.y;
    const c2 = e.x * w.y > e.y * w.x;
    if ((c0 && c1 && c2) || (!c0 && !c1 && !c2)) s = -s;
  }
  return s * Math.sqrt(d);
}

/**
 * Approximate signed distance to an axis-aligned ellipse centered at origin (negative inside).
 * Exact for circles and on the axes; degrades (toward 0) deep inside — fine for AA/mask use,
 * which only needs accuracy near the rim and a correct sign.
 */
export function sdEllipse(p: Vec2, r: Vec2): number {
  if (r.x === r.y) return len(p) - r.x;
  const k1 = len(v2(p.x / r.x, p.y / r.y));
  const k2 = len(v2(p.x / (r.x * r.x), p.y / (r.y * r.y)));
  return (k1 * (k1 - 1.0)) / Math.max(k2, 1e-12);
}
