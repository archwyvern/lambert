import { Vector2 } from "@aphralatrax/primitives";
import { v2 } from "./vec";

/** Regular n-gon around a centroid, flat-top oriented (n=4 gives an axis-aligned square). */
export function regularPolygon(centroid: Vector2, radius: number, n: number): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + Math.PI / n + (i * 2 * Math.PI) / n;
    out.push(v2(centroid.x + radius * Math.cos(a), centroid.y + radius * Math.sin(a)));
  }
  return out;
}

/** Insert `p` into a flat control-point list right after `afterIndex` (the new vertex is at
 *  `afterIndex + 1`). Used to add a vertex on a polygon/polyline/ring edge without regenerating. */
export function insertVertex(points: Vector2[], afterIndex: number, p: Vector2): Vector2[] {
  const next = points.slice();
  next.splice(afterIndex + 1, 0, p);
  return next;
}

/** Remove the vertices at `indices`, keeping at least `min`. Returns null if the delete would drop
 *  below `min` (caller leaves the object unchanged). */
export function deleteVertices(points: Vector2[], indices: number[], min: number): Vector2[] | null {
  const drop = new Set(indices);
  const keep = points.filter((_, i) => !drop.has(i));
  return keep.length >= min ? keep : null;
}

/** Centroid + mean vertex radius of an existing footprint (for count regeneration). */
export function polygonStats(points: Vector2[]): { centroid: Vector2; radius: number } {
  const centroid = v2(
    points.reduce((a, p) => a + p.x, 0) / points.length,
    points.reduce((a, p) => a + p.y, 0) / points.length,
  );
  const radius = points.reduce((a, p) => a + Math.hypot(p.x - centroid.x, p.y - centroid.y), 0) / points.length;
  return { centroid, radius: Math.max(1, radius) };
}

/** Resample a polyline to n points, evenly spaced by arc length (endpoints preserved). */
export function resamplePolyline(points: Vector2[], n: number): Vector2[] {
  if (points.length < 2 || n < 2) return points.slice();
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  const total = lengths[lengths.length - 1]!;
  if (total === 0) return Array.from({ length: n }, () => points[0]!);
  const out: Vector2[] = [];
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

/**
 * Regular n-gon whose first vertex points along refAngle (radians), the rest stepping by 2π/n
 * in regularPolygon's winding. Use when regenerating one frustum ring so its vertices stay
 * phase-locked to the sibling ring (vertex 0 over vertex 0) — otherwise the slope twists.
 */
export function regularPolygonAligned(centroid: Vector2, radius: number, n: number, refAngle: number): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = refAngle + (i * 2 * Math.PI) / n;
    out.push(v2(centroid.x + radius * Math.cos(a), centroid.y + radius * Math.sin(a)));
  }
  return out;
}

/** Direction (radians) from a ring's centroid to its first vertex — the phase a sibling aligns to. */
export function ringPhase(points: Vector2[]): number {
  const { centroid } = polygonStats(points);
  return Math.atan2(points[0]!.y - centroid.y, points[0]!.x - centroid.x);
}

/** One slope-band triangle: three [ring, index] corners (ring 0 = outer/base/h0, ring 1 = inner/top/h1). */
export type FrustumTri = [[number, number], [number, number], [number, number]];

const stripCache = new Map<string, FrustumTri[]>();

/**
 * Triangulate the slope band between an outer ring (nB verts) and inner ring (nT verts) as a
 * two-pointer strip: walk both loops by normalized position, advancing whichever ring's next vertex
 * comes first and emitting one triangle per step. Equal counts give the clean quad-per-side split
 * (vertex i pairs with vertex i); a single inner vertex fans to an apex (a pyramid); genuinely
 * unequal counts fan the extras. Rings must be phase-aligned + wound the same way. Cached by count
 * pair — treat the result as read-only.
 */
export function frustumStrip(nB: number, nT: number): FrustumTri[] {
  const key = `${nB},${nT}`;
  const hit = stripCache.get(key);
  if (hit) return hit;
  const tris: FrustumTri[] = [];
  let i = 0;
  let j = 0;
  while (i < nB || j < nT) {
    const advanceOuter = j >= nT || (i < nB && (i + 1) / nB <= (j + 1) / nT);
    if (advanceOuter) {
      tris.push([[0, i % nB], [0, (i + 1) % nB], [1, j % nT]]);
      i++;
    } else {
      tris.push([[0, i % nB], [1, j % nT], [1, (j + 1) % nT]]);
      j++;
    }
  }
  stripCache.set(key, tris);
  return tris;
}
