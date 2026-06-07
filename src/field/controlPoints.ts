import { Vec2, v2 } from "./vec";

/** Regular n-gon around a centroid, flat-top oriented (n=4 gives an axis-aligned square). */
export function regularPolygon(centroid: Vec2, radius: number, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + Math.PI / n + (i * 2 * Math.PI) / n;
    out.push(v2(centroid.x + radius * Math.cos(a), centroid.y + radius * Math.sin(a)));
  }
  return out;
}

/** Centroid + mean vertex radius of an existing footprint (for count regeneration). */
export function polygonStats(points: Vec2[]): { centroid: Vec2; radius: number } {
  const centroid = v2(
    points.reduce((a, p) => a + p.x, 0) / points.length,
    points.reduce((a, p) => a + p.y, 0) / points.length,
  );
  const radius = points.reduce((a, p) => a + Math.hypot(p.x - centroid.x, p.y - centroid.y), 0) / points.length;
  return { centroid, radius: Math.max(1, radius) };
}

/** Resample a polyline to n points, evenly spaced by arc length (endpoints preserved). */
export function resamplePolyline(points: Vec2[], n: number): Vec2[] {
  if (points.length < 2 || n < 2) return points.slice();
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  const total = lengths[lengths.length - 1]!;
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0]! }));
  const out: Vec2[] = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    while (seg < points.length - 2 && lengths[seg + 1]! < target) seg++;
    const span = lengths[seg + 1]! - lengths[seg]! || 1;
    const t = (target - lengths[seg]!) / span;
    out.push(
      v2(
        points[seg]!.x + (points[seg + 1]!.x - points[seg]!.x) * t,
        points[seg]!.y + (points[seg + 1]!.y - points[seg]!.y) * t,
      ),
    );
  }
  return out;
}
