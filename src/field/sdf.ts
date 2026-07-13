import { Vector2 } from "@aphralatrax/primitives";
import { clamp } from "./vec";

/** Unsigned distance from p to segment ab. */
export function sdSegment(p: Vector2, a: Vector2, b: Vector2): number {
  const pa = p.sub(a);
  const ba = b.sub(a);
  const h = clamp(pa.dot(ba) / ba.lengthSquared(), 0, 1);
  return pa.sub(ba.scale(h)).length();
}

/** Exact signed distance to a simple polygon (negative inside). Winding-independent. A
 *  degenerate ring has no interior: 1 point -> distance to it (cone apex), 2 -> to the segment. */
export function sdPolygon(p: Vector2, v: Vector2[]): number {
  const n = v.length;
  if (n === 1) return p.sub(v[0]!).length();
  if (n === 2) return sdSegment(p, v[0]!, v[1]!);
  let d = p.sub(v[0]!).lengthSquared();
  let s = 1.0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = v[i]!;
    const vj = v[j]!;
    const e = vj.sub(vi);
    const w = p.sub(vi);
    const t = clamp(w.dot(e) / e.lengthSquared(), 0, 1);
    d = Math.min(d, w.sub(e.scale(t)).lengthSquared());
    const c0 = p.y >= vi.y;
    const c1 = p.y < vj.y;
    const c2 = e.x * w.y > e.y * w.x;
    if ((c0 && c1 && c2) || (!c0 && !c1 && !c2)) s = -s;
  }
  return s * Math.sqrt(d);
}
