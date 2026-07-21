import type { Vector2 } from "@carapace/primitives";
import { bakeRings, bezierAnchor, loopBakeInfo, splitSubpaths } from "../bezier";
import { frustumStrip } from "../controlPoints";
import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, ObjectTypeId } from "../registry";
import { sdPolygon, sdSegment } from "../sdf";
import { segmentInv8, softRingDistance8 } from "../softDist";
import type { FieldSample, ObjectInstance } from "../types";
import { clamp, v2 } from "../vec";
import { triHeight } from "./plateau";

const MESA_H = 24;

/**
 * Does the top rim CROSS the base ring (some baked top point outside it)? The crossed-rim skirt
 * only exists under a genuine fold: the two rings bake independently (different counts, densities,
 * start anchors), so the strip pairing the skirt lofts is only meaningful when the rims cross —
 * on a nested Mesa (especially concave ones) mismatched pairing produced giant phantom faces
 * spanning the shape's exterior. Nested rims therefore never consult the skirt at all. Memoized on
 * the baked controlPoints identity; pack.ts writes the same answer into PARAM1 for the WGSL twin.
 */
/**
 * Corner-to-corner seam runs. Hard-corner anchors (crisp corners: both resolved tangents zero)
 * split each ring into RUNS; base run k pairs with top run k in anchor order — the same
 * correspondence a converted Plateau carries. The band field then blends PER-FACE distance
 * ratios weighted by run proximity (see mesaEval), which pins the transition between adjacent
 * slope faces through BOTH paired corners — the global field's bisector seams drifted off the
 * corners whenever the band was not a uniform inset. null (no seams; global field) when the
 * loops' hard-corner counts differ, there are fewer than 2, more than MAX_SEAMS (the WGSL
 * accumulator array bound), or the bake bookkeeping doesn't match the baked rings.
 * `starts` are ring-LOCAL baked indices, ascending. Memoized on the baked controlPoints identity;
 * pack.ts ships the same runs to the WGSL twin (PARAM2 = count, PARAM3 = points-buffer offset).
 */
export interface MesaSeamRuns {
  baseStarts: number[];
  topStarts: number[];
}
export const MAX_SEAMS = 16;
const SEAM_GAMMA = 4 / 7; // face-blend weight exponent on the run integrals (see mesaEval)
const seamMemo = new WeakMap<Vector2[], MesaSeamRuns | null>();
export function mesaSeamRuns(object: ObjectInstance): MesaSeamRuns | null {
  // bezier-less mesas (or foreign cps) have no seams — decide BEFORE the memo so the cache never
  // holds an answer derived from another object's bezier state
  const subs = object.subpathStarts;
  if (!object.bezier || !subs || subs.length !== 2) return null;
  const cps = object.controlPoints;
  const hit = seamMemo.get(cps);
  if (hit !== undefined) return hit;
  let out: MesaSeamRuns | null = null;
  {
    const loops = splitSubpaths(object.bezier, subs);
    const nB = object.ringSplit ?? (cps.length >> 1);
    const infoB = loopBakeInfo(loops[0]!);
    const infoT = loopBakeInfo(loops[1]!);
    if (infoB.total === nB && infoT.total === cps.length - nB) {
      const baseStarts = infoB.starts.filter((_, i) => infoB.corner[i]);
      const topStarts = infoT.starts.filter((_, i) => infoT.corner[i]);
      if (baseStarts.length >= 2 && baseStarts.length === topStarts.length && baseStarts.length <= MAX_SEAMS) {
        out = { baseStarts, topStarts };
      }
    }
  }
  seamMemo.set(cps, out);
  return out;
}

/** Accumulate one ring's ∮ds/d⁸ integral bucketed per run (runStarts = ascending ring-local baked
 *  indices of the hard corners; segments before the first corner wrap to the LAST run). */
function accumulateRuns(p: Vector2, cps: Vector2[], start: number, count: number, runStarts: number[], out: number[]): void {
  let bucket = runStarts.length - 1;
  let next = 0;
  for (let j = 0; j < count; j++) {
    while (next < runStarts.length && j >= runStarts[next]!) {
      bucket = next;
      next++;
    }
    out[bucket]! += segmentInv8(p.x, p.y, cps[start + j]!, cps[start + ((j + 1) % count)]!);
  }
}

const crossedMemo = new WeakMap<Vector2[], boolean>();
export function mesaRingsCross(cps: Vector2[], nB: number): boolean {
  const hit = crossedMemo.get(cps);
  if (hit !== undefined) return hit;
  const outer = cps.slice(0, nB);
  let crossed = false;
  for (let i = nB; i < cps.length && !crossed; i++) crossed = sdPolygon(cps[i]!, outer) > 0;
  crossedMemo.set(cps, crossed);
  return crossed;
}

/**
 * Mesa CPU eval — mirrored exactly by shape_mesa in the WGSL below (drift-tested by the selftest).
 *
 * The slope band is the ratio of the two rings' SHARP soft distances: t = D_B / (D_B + D_T),
 * 0 at the outer curve, 1 at the inner rim, where D = (∮ ds/d⁸)^(-1/7) (softRingDistance8). The
 * d⁸ kernel is local enough that a straight run reads t = depth / bandWidth (a flat chamfer) and
 * corners fillet tightly, while the INTEGRAL form keeps it C∞ AND invariant to how densely the
 * outline baked. That last property is load-bearing — the discrete alternatives all failed:
 * exact min distance creased at every ring vertex; a p-norm smooth-min over per-segment
 * distances fixed the creases but GROOVED at every BAKED vertex (any sum of per-segment terms
 * changes under subdivision — two half-segments tie where one segment didn't); the original d⁴
 * integral (Pillow's, softDist.ts) was tessellation-clean but bowed the whole corner band
 * (t ~ 0.25 at the corner-diagonal midpoint vs ~ 0.36 here). Chosen by measured
 * tessellation-sensitivity + side-by-side renders of all four. Before all of that, the paired
 * trapezoid LOFT was rejected for facet banding + equal-count ring pairing — do not resurrect
 * it for the band (it still drives the crossed-rim skirt, where it's exact).
 */
export function mesaEval(p: Vector2, object: ObjectInstance): FieldSample {
  const profile = enumParam(object, "profile") as ProfileKind;
  const cps = object.controlPoints;
  const nB = object.ringSplit ?? (cps.length >> 1);
  const nT = cps.length - nB;
  const sdB = sdPolygon(p, cps.slice(0, nB));
  const sdT = sdPolygon(p, cps.slice(nB));
  // angled-view rules, like Plateau's crossed rims: the top rim hides everything under it wherever
  // it sits (footprint = ring union + skirt), the interior slope band is the exact distance ratio
  // (linear chamfer — see the header comment), and OUTSIDE both rings the crossed-rim skirt is the
  // baked-ring loft strip (the loft-hybrid: faces only exist where the band has no footprint,
  // meeting it at 0 on the base outline and 1 on the top outline, so nothing changes for nested
  // rims).
  if (sdT <= 0) return { height: MESA_H * applyProfile(profile, 1, 1), sd: Math.min(sdB, sdT) };
  if (sdB < 0) {
    // corner-to-corner seams: with paired hard corners, blend PER-FACE distance ratios weighted
    // by run proximity (the raw run integrals, ~ d^-7) — adjacent runs share each corner point,
    // so the face transition is pinned through both corners. Without seams: the global ratio.
    const seams = mesaSeamRuns(object);
    if (seams) {
      const K = seams.baseStarts.length;
      const invB = new Array<number>(K).fill(0);
      const invT = new Array<number>(K).fill(0);
      accumulateRuns(p, cps, 0, nB, seams.baseStarts, invB);
      accumulateRuns(p, cps, nB, nT, seams.topStarts, invT);
      let num = 0;
      let den = 0;
      for (let k = 0; k < K; k++) {
        const wB = invB[k]!;
        const wT = invT[k]!;
        if (wB <= 0 || wT <= 0) continue; // underflowed far run: negligible weight anyway
        const dBk = Math.pow(wB, -1 / 7);
        const dTk = Math.pow(wT, -1 / 7);
        const w = Math.pow(wB + wT, SEAM_GAMMA);
        num += w * (dBk / (dBk + dTk));
        den += w;
      }
      if (den > 0) return { height: MESA_H * applyProfile(profile, clamp(num / den, 0, 1), 1), sd: sdB };
    }
    const dB = softRingDistance8(p, cps, 0, nB);
    const dT = softRingDistance8(p, cps, nB, nT);
    const t = clamp(dB / Math.max(dB + dT, 1e-6), 0, 1);
    return { height: MESA_H * applyProfile(profile, t, 1), sd: sdB };
  }
  if (!mesaRingsCross(cps, nB)) return { height: 0, sd: Math.min(sdB, sdT) };
  const ring = (r: number, idx: number): Vector2 => cps[r === 0 ? idx : nB + idx]!;
  let t = 0;
  let hitFace = false;
  let sdF = Infinity;
  for (const [a, b, c] of frustumStrip(nB, nT)) {
    const pa = ring(a[0], a[1]);
    const pb = ring(b[0], b[1]);
    const pc = ring(c[0], c[1]);
    const hit = triHeight(p, pa, pb, pc, a[0], b[0], c[0]);
    if (hit !== null) {
      t = hitFace ? Math.max(t, hit) : hit;
      hitFace = true;
    }
    const d = Math.min(sdSegment(p, pa, pb), sdSegment(p, pb, pc), sdSegment(p, pc, pa));
    sdF = Math.min(sdF, hit !== null ? -d : d);
  }
  const sd = Math.min(sdB, sdT, sdF);
  if (!hitFace) return { height: 0, sd };
  return { height: MESA_H * applyProfile(profile, clamp(t, 0, 1), 1), sd };
}

/**
 * Mesa — the Bézier twin of the primitive Plateau: a base ring and a top rim, both CLOSED
 * Bézier loops (subpaths) baked into two controlPoint rings (base + top split at ringSplit).
 * The slope between them is the soft-distance blend above — no loft seams, no ring-pairing
 * constraint. `bezier` holds both loops concatenated; `subpathStarts` marks the boundary; Gizmos
 * rebakes the rings on every edit. Drawable directly and produced by converting a Plateau.
 */
export const PlateauVector = defineObjectType({
  id: ObjectTypeId.PlateauVector,
  name: "Mesa",
  category: "Paths",
  params: {
    profile: { type: "enum", options: PROFILE_KINDS, default: "linear" },
  },
  nominalHeight: MESA_H,
  controlPoints: { kind: "rings", min: 3, default: [] }, // baked from the two Bézier loops in `bezier`
  onCreate(o) {
    // manual HARD-CORNER anchors (like Contour): the default is a crisp frustum; smooth-curve rims
    // come from toggling anchors, not from surprise Catmull-Rom rounding of the starter shape
    const corner = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
    const baseLoop = [corner(-32, -32), corner(32, -32), corner(32, 32), corner(-32, 32)];
    const topLoop = [corner(-20, -20), corner(20, -20), corner(20, 20), corner(-20, 20)];
    o.bezier = [...baseLoop, ...topLoop];
    o.subpathStarts = [0, baseLoop.length];
    o.closed = true;
    const r = bakeRings(o.bezier, o.subpathStarts);
    o.controlPoints = r.controlPoints;
    o.ringSplit = r.ringSplit;
    o.contourCounts = r.contourCounts;
  },
  // params: 13 = profile. cps: base ring (nB = rec(SLOT_RING)) then top rim.
  wgsl: /* wgsl */ `
fn shape_mesa(p: vec2f, base: u32) -> vec2f {
  let h = 24.0;
  let prof = u32(rec(base, SLOT_PARAM0));
  let cs = u32(rec(base, SLOT_CP_START));
  let nB = u32(rec(base, SLOT_RING));
  let nT = u32(rec(base, SLOT_CP_COUNT)) - nB;
  let sdB = sd_polygon(p, cs, nB);
  let sdT = sd_polygon(p, cs + nB, nT);
  if (sdT <= 0.0) { return vec2f(h * apply_profile(prof, 1.0, 1.0), min(sdB, sdT)); }
  if (sdB < 0.0) {
    // corner-to-corner seams (mirrors mesaEval): PARAM2 = run count, PARAM3 = points-buffer
    // offset of the K run-start pairs (x = base-local, y = top-local baked index).
    let K = u32(rec(base, SLOT_PARAM2));
    if (K >= 2u) {
      let soff = u32(rec(base, SLOT_PARAM3));
      var invB: array<f32, 16>;
      var invT: array<f32, 16>;
      for (var k = 0u; k < 16u; k = k + 1u) { invB[k] = 0.0; invT[k] = 0.0; }
      var bucket = K - 1u;
      var next = 0u;
      for (var j = 0u; j < nB; j = j + 1u) {
        while (next < K && j >= u32(points[soff + next].x)) { bucket = next; next = next + 1u; }
        let a = points[cs + j];
        let b2 = points[cs + select(j + 1u, 0u, j + 1u >= nB)];
        invB[bucket] = invB[bucket] + soft_seg_inv8(p, a, b2);
      }
      bucket = K - 1u;
      next = 0u;
      for (var j = 0u; j < nT; j = j + 1u) {
        while (next < K && j >= u32(points[soff + next].y)) { bucket = next; next = next + 1u; }
        let a = points[cs + nB + j];
        let b2 = points[cs + nB + select(j + 1u, 0u, j + 1u >= nT)];
        invT[bucket] = invT[bucket] + soft_seg_inv8(p, a, b2);
      }
      var num = 0.0;
      var den = 0.0;
      for (var k = 0u; k < K; k = k + 1u) {
        let wB = invB[k];
        let wT = invT[k];
        if (wB > 0.0 && wT > 0.0) {
          let dBk = pow(wB, -0.14285714285714285);
          let dTk = pow(wT, -0.14285714285714285);
          let w = pow(wB + wT, 0.5714285714285714); // SEAM_GAMMA = 4/7
          num = num + w * (dBk / (dBk + dTk));
          den = den + w;
        }
      }
      if (den > 0.0) { return vec2f(h * apply_profile(prof, clamp(num / den, 0.0, 1.0), 1.0), sdB); }
    }
    let dB = soft_ring_dist8(p, cs, nB);
    let dT = soft_ring_dist8(p, cs + nB, nT);
    let t = clamp(dB / max(dB + dT, 1e-6), 0.0, 1.0);
    return vec2f(h * apply_profile(prof, t, 1.0), sdB);
  }
  // nested rims never grow a skirt (PARAM7 = pack-time mesaRingsCross flag; PARAM1+ hold the
  // generic contour counts)
  if (rec(base, SLOT_PARAM7) < 0.5) { return vec2f(0.0, min(sdB, sdT)); }
  // outside both rings: crossed-rim skirt — the baked-ring loft strip (mirrors mesaEval)
  var t = 0.0;
  var hitFace = false;
  var sdF = 1e30;
  var i = 0u;
  var j = 0u;
  let steps = nB + nT;
  for (var k = 0u; k < steps; k = k + 1u) {
    let advanceOuter = (j >= nT) || (i < nB && (f32(i + 1u) / f32(nB) <= f32(j + 1u) / f32(nT)));
    var a = points[cs + (i % nB)];
    var b: vec2f;
    var c: vec2f;
    var hb = 0.0;
    if (advanceOuter) {
      b = points[cs + ((i + 1u) % nB)];
      c = points[cs + nB + (j % nT)];
      i = i + 1u;
    } else {
      b = points[cs + nB + (j % nT)];
      c = points[cs + nB + ((j + 1u) % nT)];
      hb = 1.0;
      j = j + 1u;
    }
    let r = plateau_tri(p, a, b, c, 0.0, hb, 1.0);
    let d = min(sd_segment(p, a, b), min(sd_segment(p, b, c), sd_segment(p, c, a)));
    if (r.y > 0.5) {
      t = select(r.x, max(t, r.x), hitFace);
      hitFace = true;
      sdF = min(sdF, -d);
    } else {
      sdF = min(sdF, d);
    }
  }
  let sd = min(min(sdB, sdT), sdF);
  if (!hitFace) { return vec2f(0.0, sd); }
  return vec2f(h * apply_profile(prof, clamp(t, 0.0, 1.0), 1.0), sd);
}
`,
  eval: mesaEval,
});
