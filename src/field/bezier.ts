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
  /** Tangent symmetry when dragging a handle: undefined/true = the opposite handle mirrors;
   *  false = the two handles move independently. Alt held during a drag inverts this. UI-only
   *  (the fold uses the resolved tangents regardless). */
  sym?: boolean;
  /** Per-anchor CROSS-SECTION multiplier (default 1), interpolated along each segment — tapers the
   *  swept stroke as a unit (Pipe: radius·scale; Berm: width+slope+height·scale). Distinct from the
   *  object's transform.scale. A Frustum converts to a vector by setting the two end scales. */
  scale?: number;
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
export function cubicNearest(
  p: Vector2,
  p0: Vector2,
  c0: Vector2,
  c1: Vector2,
  p1: Vector2,
  cutStart = false,
  cutEnd = false,
): { dist: number; t: number } {
  // 16-sample bracket isolates the global nearest even when long tangents loop/cusp the curve; the
  // final min() guards against a diverging Newton step (mirror of the WGSL cubic_dist_t).
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
  if (cutEnd && t > 0.9999 && (p.x - p1.x) * (p1.x - c1.x) + (p.y - p1.y) * (p1.y - c1.y) > 0) return { dist: 1e30, t };
  if (cutStart && t < 0.0001 && (p.x - p0.x) * (c0.x - p0.x) + (p.y - p0.y) * (c0.y - p0.y) < 0) return { dist: 1e30, t };
  const B = cubicAt(p0, c0, c1, p1, t);
  const dn = (B.x - p.x) ** 2 + (B.y - p.y) ** 2;
  if (dn <= bestD) return { dist: Math.sqrt(dn), t };
  return { dist: Math.sqrt(bestD), t: bestT };
}

/** Smooth distance from p to a cubic segment (the t-discarding form of cubicNearest). */
export function cubicDist(
  p: Vector2,
  p0: Vector2,
  c0: Vector2,
  c1: Vector2,
  p1: Vector2,
  cutStart = false,
  cutEnd = false,
): number {
  return cubicNearest(p, p0, c0, c1, p1, cutStart, cutEnd).dist;
}

/** Sample the cubic-Bézier path into a dense polyline (perSeg points per segment). Open: ends at the
 *  final endpoint. `closed` (needs >= 3 anchors): wraps the last->first segment with wrap-around smooth
 *  tangents and ends back at the first point. Fewer than 2 anchors return their points. */
export function bezierSpine(anchors: BezierAnchor[], perSeg = 16, closed = false): Vector2[] {
  if (anchors.length < 2) return anchors.map((a) => v2(a.p.x, a.p.y));
  const loop = closed && anchors.length >= 3;
  const r = loop ? resolveHandlesClosed(anchors) : resolveHandles(anchors);
  const out: Vector2[] = [];
  const segs = loop ? r.length : r.length - 1;
  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % r.length;
    const p0 = r[i]!.p;
    const c0 = ctrlOut(r[i]!);
    const c1 = ctrlIn(r[i1]!);
    const p1 = r[i1]!.p;
    for (let s = 0; s < perSeg; s++) out.push(cubic(p0, c0, c1, p1, s / perSeg));
  }
  const end = loop ? r[0]!.p : r[r.length - 1]!.p;
  out.push(v2(end.x, end.y));
  return out;
}

/**
 * Closed-loop variant of resolveHandles: every "smooth" anchor derives Catmull-Rom tangents from
 * its wrap-around neighbours (the first anchor's prev is the last, the last anchor's next is the
 * first). "manual" anchors pass through. Used to bake closed mask paths.
 */
export function resolveHandlesClosed(anchors: BezierAnchor[]): BezierAnchor[] {
  const n = anchors.length;
  return anchors.map((a, i) => {
    if (a.mode === "manual") return a;
    const prev = anchors[(i - 1 + n) % n]!.p;
    const next = anchors[(i + 1) % n]!.p;
    const t = v2((next.x - prev.x) / 6, (next.y - prev.y) / 6);
    return { ...a, hOut: t, hIn: v2(-t.x, -t.y) };
  });
}

/**
 * Bake a CLOSED Bézier path (mask loop) to a dense polygon for the inside/AA test. A straight
 * segment (both touching handles zero — i.e. corner anchors) contributes only its start vertex, so
 * an all-corner loop bakes to exactly its anchor points (a polygon); curved segments emit `perSeg`
 * samples. The returned ring is implicitly closed (no duplicated first vertex) — sdPolygon wraps.
 */
export function bakeMaskLoop(anchors: BezierAnchor[], perSeg = 12): Vector2[] {
  if (anchors.length < 3) return anchors.map((a) => v2(a.p.x, a.p.y));
  const r = resolveHandlesClosed(anchors);
  const n = r.length;
  const out: Vector2[] = [];
  const zero = (h: Vector2): boolean => Math.abs(h.x) < 1e-9 && Math.abs(h.y) < 1e-9;
  for (let i = 0; i < n; i++) {
    const a0 = r[i]!;
    const a1 = r[(i + 1) % n]!;
    if (zero(a0.hOut) && zero(a1.hIn)) {
      out.push(v2(a0.p.x, a0.p.y)); // straight segment: just the start vertex
      continue;
    }
    const p0 = a0.p;
    const c0 = ctrlOut(a0);
    const c1 = ctrlIn(a1);
    const p1 = a1.p;
    for (let s = 0; s < perSeg; s++) out.push(cubic(p0, c0, c1, p1, s / perSeg));
  }
  return out;
}

/** Per-anchor bake bookkeeping for one closed loop: each anchor's start index in the bakeMaskLoop
 *  output, whether it is a CRISP CORNER (both resolved tangents zero — a real tangent break), and
 *  the total baked count. MUST stay in lockstep with bakeMaskLoop's emission rule above (straight
 *  segment -> 1 vertex, curved -> perSeg). Mesa's corner-to-corner seam runs are derived from it. */
export function loopBakeInfo(anchors: BezierAnchor[], perSeg = 12): { starts: number[]; corner: boolean[]; total: number } {
  if (anchors.length < 3) {
    return { starts: anchors.map((_, i) => i), corner: anchors.map(() => false), total: anchors.length };
  }
  const r = resolveHandlesClosed(anchors);
  const zero = (h: Vector2): boolean => Math.abs(h.x) < 1e-9 && Math.abs(h.y) < 1e-9;
  const starts: number[] = [];
  const corner: boolean[] = [];
  let idx = 0;
  for (let i = 0; i < r.length; i++) {
    starts.push(idx);
    corner.push(zero(r[i]!.hIn) && zero(r[i]!.hOut));
    idx += zero(r[i]!.hOut) && zero(r[(i + 1) % r.length]!.hIn) ? 1 : perSeg;
  }
  return { starts, corner, total: idx };
}

/** Split a flat anchor list into subpath loops at the given start indices (absent/single = one loop). */
export function splitSubpaths(anchors: BezierAnchor[], subpathStarts?: number[]): BezierAnchor[][] {
  if (!subpathStarts || subpathStarts.length <= 1) return [anchors];
  return subpathStarts.map((s, i) => anchors.slice(s, i + 1 < subpathStarts.length ? subpathStarts[i + 1] : anchors.length));
}

/** Bake each closed Bézier subpath to a dense polygon and concatenate them into one ring list (the
 *  first loop is the base ring); `ringSplit` is the baked base-ring vertex count. For Mesa:
 *  two loops -> base + top rings consumed by the shared Plateau eval/WGSL. */
export function bakeRings(anchors: BezierAnchor[], subpathStarts?: number[]): { controlPoints: Vector2[]; ringSplit: number; contourCounts: number[] } {
  const baked = splitSubpaths(anchors, subpathStarts).map((l) => bakeMaskLoop(l));
  return { controlPoints: baked.flat(), ringSplit: baked[0]?.length ?? 0, contourCounts: baked.map((b) => b.length) };
}

/** Bake a closed loop to a UNIFORM perSeg-samples-per-segment polygon (no straight-segment skip). Two
 *  loops with the same anchor count bake to the SAME point count — required for the Mesa
 *  paired loft (base[k] <-> top[k]) so it doesn't fan a dense curved ring across a sparse straight one. */
export function bakeLoopUniform(anchors: BezierAnchor[], perSeg = 8): Vector2[] {
  if (anchors.length < 3) return anchors.map((a) => v2(a.p.x, a.p.y));
  const r = resolveHandlesClosed(anchors);
  const n = r.length;
  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = r[i]!;
    const a1 = r[(i + 1) % n]!;
    const p0 = a0.p;
    const c0 = ctrlOut(a0);
    const c1 = ctrlIn(a1);
    const p1 = a1.p;
    for (let s = 0; s < perSeg; s++) out.push(cubic(p0, c0, c1, p1, s / perSeg));
  }
  return out;
}

/** bakeRings with uniform per-segment sampling — base + top bake to equal counts (for equal anchor
 *  counts), giving the Mesa loft clean 1:1 pairing instead of a fan. */
export function bakeRingsUniform(anchors: BezierAnchor[], subpathStarts?: number[], perSeg = 8): { controlPoints: Vector2[]; ringSplit: number; contourCounts: number[] } {
  const baked = splitSubpaths(anchors, subpathStarts).map((l) => bakeLoopUniform(l, perSeg));
  return { controlPoints: baked.flat(), ringSplit: baked[0]?.length ?? 0, contourCounts: baked.map((b) => b.length) };
}

/** Per-loop closed-aware handle resolution across all subpaths, reassembled into one global array
 *  (indices match `anchors`). THE resolution for edit operations on multi-loop paths — plain
 *  resolveHandles on the concatenated array gets both the loop seams and the wrap tangents wrong. */
export function resolvePath(anchors: BezierAnchor[], subpathStarts: number[] | undefined, closed: boolean): BezierAnchor[] {
  return splitSubpaths(anchors, subpathStarts).flatMap((loop) =>
    closed && loop.length >= 3 ? resolveHandlesClosed(loop) : resolveHandles(loop),
  );
}

export interface PathHit {
  /** Global index of the hit loop's first anchor. */
  loopStart: number;
  loopLen: number;
  /** Loop-LOCAL segment: runs loop[seg] -> loop[(seg+1) % loopLen] (so a closed loop's wrap
   *  segment is seg = loopLen-1). */
  seg: number;
  t: number;
  dist: number;
  point: Vector2;
}

/**
 * Nearest point on a multi-loop path to p — per subpath loop, closed-aware. Unlike a naive search
 * over the concatenated anchors this includes each closed loop's WRAP segment (last -> first) and
 * never fabricates a segment bridging one loop's end to the next loop's start.
 */
export function nearestOnPath(anchors: BezierAnchor[], subpathStarts: number[] | undefined, closed: boolean, p: Vector2): PathHit | null {
  const SUB = 24;
  let best: PathHit | null = null;
  let bestD = Infinity;
  let start = 0;
  for (const loop of splitSubpaths(anchors, subpathStarts)) {
    if (loop.length >= 2) {
      const r = closed && loop.length >= 3 ? resolveHandlesClosed(loop) : resolveHandles(loop);
      const segs = closed && loop.length >= 3 ? loop.length : loop.length - 1;
      for (let i = 0; i < segs; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        for (let sub = 0; sub <= SUB; sub++) {
          const t = sub / SUB;
          const q = cubic(a.p, ctrlOut(a), ctrlIn(b), b.p, t);
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { loopStart: start, loopLen: loop.length, seg: i, t, dist: 0, point: q };
          }
        }
      }
    }
    start += loop.length;
  }
  if (best) best.dist = Math.sqrt(bestD);
  return best;
}

/**
 * de Casteljau insert at a PathHit, preserving the exact curve: the split's two neighbours are
 * pinned manual with the split tangents (their far-side tangents baked from the closed-aware
 * resolution) and the new anchor sits between them. Handles wrap segments (the new anchor lands at
 * the END of its loop) and bumps subpathStarts after the insertion point so later loops stay intact.
 */
export function insertOnPath(
  anchors: BezierAnchor[],
  subpathStarts: number[] | undefined,
  closed: boolean,
  hit: PathHit,
): { anchors: BezierAnchor[]; subpathStarts: number[] | undefined; index: number } {
  const r = resolvePath(anchors, subpathStarts, closed);
  const ga = hit.loopStart + hit.seg;
  const gb = hit.loopStart + ((hit.seg + 1) % hit.loopLen);
  const a0 = r[ga]!;
  const a1 = r[gb]!;
  const P0 = a0.p;
  const P1 = a1.p;
  const t = hit.t;
  const A = lerp(P0, ctrlOut(a0), t);
  const B = lerp(ctrlOut(a0), ctrlIn(a1), t);
  const C = lerp(ctrlIn(a1), P1, t);
  const D = lerp(A, B, t);
  const E = lerp(B, C, t);
  const F = lerp(D, E, t); // the new anchor point
  const next = anchors.slice();
  next[ga] = { ...a0, hOut: v2(A.x - P0.x, A.y - P0.y), mode: "manual" };
  next[gb] = { ...a1, hIn: v2(C.x - P1.x, C.y - P1.y), mode: "manual" };
  const index = hit.loopStart + hit.seg + 1; // wrap segment -> loopStart + loopLen = the loop's end
  next.splice(index, 0, { p: F, hIn: v2(D.x - F.x, D.y - F.y), hOut: v2(E.x - F.x, E.y - F.y), mode: "manual" });
  return { anchors: next, subpathStarts: subpathStarts?.map((st) => (st >= index ? st + 1 : st)), index };
}

