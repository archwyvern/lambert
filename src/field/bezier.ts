import { Vector2 } from "@carapace/primitives";
import { v2 } from "./vec";

/** A cubic-Bézier path anchor: a point plus two tangent handles, stored as offsets from the
 *  point. hIn governs the incoming segment, hOut the outgoing.
 *
 *  mode "smooth" (the default) means the handles are IGNORED and re-derived from the neighbouring
 *  anchors (Catmull-Rom) every time the path is evaluated — so the curve flows smoothly through the
 *  point and stays smooth as it's dragged. mode "manual" uses the stored hIn/hOut verbatim; it's set
 *  the moment the user grabs a tangent handle. Resolve a path with resolveHandles() before sampling. */
export interface BezierAnchor {
  p: Vector2;
  hIn: Vector2;
  hOut: Vector2;
  mode?: "smooth" | "manual";
}

export const bezierAnchor = (
  p: Vector2,
  hIn: Vector2 = v2(0, 0),
  hOut: Vector2 = v2(0, 0),
  mode: "smooth" | "manual" = "smooth",
): BezierAnchor => ({ p, hIn, hOut, mode });

/**
 * Replace every "smooth" anchor's tangents with Catmull-Rom handles derived from its neighbours
 * (interior: ±(next-prev)/6; an end: a third of the way toward its one neighbour). "manual" anchors
 * pass through untouched. EVERY consumer (eval, GPU pack, gizmo overlay, spine, nearest) resolves
 * first so the smooth curve is identical on the CPU and the GPU.
 */
export function resolveHandles(anchors: BezierAnchor[]): BezierAnchor[] {
  const n = anchors.length;
  return anchors.map((a, i) => {
    if (a.mode === "manual") return a;
    const prev = i > 0 ? anchors[i - 1]!.p : null;
    const next = i < n - 1 ? anchors[i + 1]!.p : null;
    if (prev && next) {
      const t = v2((next.x - prev.x) / 6, (next.y - prev.y) / 6);
      return { ...a, hOut: t, hIn: v2(-t.x, -t.y) };
    }
    if (next) return { ...a, hOut: v2((next.x - a.p.x) / 3, (next.y - a.p.y) / 3), hIn: v2(0, 0) };
    if (prev) return { ...a, hIn: v2((prev.x - a.p.x) / 3, (prev.y - a.p.y) / 3), hOut: v2(0, 0) };
    return { ...a, hIn: v2(0, 0), hOut: v2(0, 0) };
  });
}

const lerp = (a: Vector2, b: Vector2, t: number): Vector2 => v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

/** Point on a cubic Bézier at parameter t. The eval + GPU both sample with this exact formula
 *  (the WGSL `cubic_at` mirrors it) so the directly-rendered curve stays GPU==CPU. */
export function cubicAt(p0: Vector2, c0: Vector2, c1: Vector2, p1: Vector2, t: number): Vector2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return v2(a * p0.x + b * c0.x + c * c1.x + d * p1.x, a * p0.y + b * c0.y + c * c1.y + d * p1.y);
}

export const ctrlOut = (a: BezierAnchor): Vector2 => v2(a.p.x + a.hOut.x, a.p.y + a.hOut.y);
export const ctrlIn = (a: BezierAnchor): Vector2 => v2(a.p.x + a.hIn.x, a.p.y + a.hIn.y);
const cubic = cubicAt;

function cubicD1(p0: Vector2, c0: Vector2, c1: Vector2, p1: Vector2, t: number): Vector2 {
  const u = 1 - t;
  return v2(
    3 * u * u * (c0.x - p0.x) + 6 * u * t * (c1.x - c0.x) + 3 * t * t * (p1.x - c1.x),
    3 * u * u * (c0.y - p0.y) + 6 * u * t * (c1.y - c0.y) + 3 * t * t * (p1.y - c1.y),
  );
}
function cubicD2(p0: Vector2, c0: Vector2, c1: Vector2, p1: Vector2, t: number): Vector2 {
  const u = 1 - t;
  return v2(
    6 * u * (c1.x - 2 * c0.x + p0.x) + 6 * t * (p1.x - 2 * c1.x + c0.x),
    6 * u * (c1.y - 2 * c0.y + p0.y) + 6 * t * (p1.y - 2 * c1.y + c0.y),
  );
}

/**
 * SMOOTH distance from p to a cubic segment: coarse-scan for the nearest t, then Newton-refine
 * the closest-point condition dot(B(t)-p, B'(t)) = 0. Mirrors the WGSL `cubic_dist` exactly so
 * the directly-rendered cable stays GPU==CPU. A smooth distance is what keeps the normals facet-free.
 */
export function cubicDist(
  p: Vector2,
  p0: Vector2,
  c0: Vector2,
  c1: Vector2,
  p1: Vector2,
  cutStart = false,
  cutEnd = false,
): number {
  // 16-sample bracket isolates the global nearest even when long tangents loop/cusp the curve; the
  // final min() guards against a diverging Newton step (mirror of the WGSL cubic_dist).
  let bestT = 0;
  let bestD = Infinity;
  for (let s = 0; s <= 16; s++) {
    const t = s / 16;
    const q = cubicAt(p0, c0, c1, p1, t);
    const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dd < bestD) {
      bestD = dd;
      bestT = t;
    }
  }
  let t = bestT;
  for (let it = 0; it < 4; it++) {
    const B = cubicAt(p0, c0, c1, p1, t);
    const d1 = cubicD1(p0, c0, c1, p1, t);
    const d2 = cubicD2(p0, c0, c1, p1, t);
    const fp = d1.x * d1.x + d1.y * d1.y + (B.x - p.x) * d2.x + (B.y - p.y) * d2.y;
    if (Math.abs(fp) > 1e-5) {
      const f = (B.x - p.x) * d1.x + (B.y - p.y) * d1.y;
      t = Math.min(1, Math.max(0, t - f / fp));
    }
  }
  // flat cap: nearest pinned at this end (t at the boundary) AND strictly beyond it -> outside (local
  // Voronoi test, mirror of the WGSL — an infinite half-plane would slice off curved tube far away)
  if (cutEnd && t > 0.9999 && (p.x - p1.x) * (p1.x - c1.x) + (p.y - p1.y) * (p1.y - c1.y) > 0) return 1e30;
  if (cutStart && t < 0.0001 && (p.x - p0.x) * (c0.x - p0.x) + (p.y - p0.y) * (c0.y - p0.y) < 0) return 1e30;
  const B = cubicAt(p0, c0, c1, p1, t);
  return Math.sqrt(Math.min(bestD, (B.x - p.x) ** 2 + (B.y - p.y) ** 2));
}

/** Sample the cubic-Bézier path into a dense polyline (perSeg points per segment + the final
 *  endpoint). Fewer than 2 anchors return their points. This is what eval + the GPU fold walk. */
export function bezierSpine(anchors: BezierAnchor[], perSeg = 16): Vector2[] {
  if (anchors.length < 2) return anchors.map((a) => v2(a.p.x, a.p.y));
  const r = resolveHandles(anchors);
  const out: Vector2[] = [];
  for (let i = 0; i < r.length - 1; i++) {
    const p0 = r[i]!.p;
    const c0 = ctrlOut(r[i]!);
    const c1 = ctrlIn(r[i + 1]!);
    const p1 = r[i + 1]!.p;
    for (let s = 0; s < perSeg; s++) out.push(cubic(p0, c0, c1, p1, s / perSeg));
  }
  const last = r[r.length - 1]!.p;
  out.push(v2(last.x, last.y));
  return out;
}

/**
 * de Casteljau split: insert a new anchor on segment `seg` at parameter `t`, preserving the
 * exact curve. Returns a new anchors array — the split's two neighbours get adjusted handles and
 * the new anchor sits between them with matching tangents.
 */
export function splitSegment(anchors: BezierAnchor[], seg: number, t: number): BezierAnchor[] {
  const a0 = anchors[seg]!;
  const a1 = anchors[seg + 1]!;
  const P0 = a0.p;
  const P1 = a1.p;
  const C0 = ctrlOut(a0);
  const C1 = ctrlIn(a1);
  const A = lerp(P0, C0, t);
  const B = lerp(C0, C1, t);
  const C = lerp(C1, P1, t);
  const D = lerp(A, B, t);
  const E = lerp(B, C, t);
  const F = lerp(D, E, t); // the new anchor point
  const next = anchors.slice();
  next[seg] = { ...a0, hOut: v2(A.x - P0.x, A.y - P0.y) };
  next[seg + 1] = { ...a1, hIn: v2(C.x - P1.x, C.y - P1.y) };
  next.splice(seg + 1, 0, { p: F, hIn: v2(D.x - F.x, D.y - F.y), hOut: v2(E.x - F.x, E.y - F.y) });
  return next;
}

/** Nearest point on the (resolved) curve to p: the segment index, parameter t, distance, and the
 *  point itself — the point is what an insert drops a new anchor onto. */
export function nearestOnSpine(
  anchors: BezierAnchor[],
  p: Vector2,
): { seg: number; t: number; dist: number; point: Vector2 } | null {
  if (anchors.length < 2) return null;
  const r = resolveHandles(anchors);
  const SUB = 24;
  let best = Infinity;
  let bestSeg = 0;
  let bestT = 0;
  let bestPt = r[0]!.p;
  for (let i = 0; i < r.length - 1; i++) {
    const p0 = r[i]!.p;
    const c0 = ctrlOut(r[i]!);
    const c1 = ctrlIn(r[i + 1]!);
    const p1 = r[i + 1]!.p;
    for (let s = 0; s <= SUB; s++) {
      const t = s / SUB;
      const q = cubic(p0, c0, c1, p1, t);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < best) {
        best = d;
        bestSeg = i;
        bestT = t;
        bestPt = q;
      }
    }
  }
  return { seg: bestSeg, t: bestT, dist: Math.sqrt(best), point: bestPt };
}
