import { Vector2 } from "@carapace/primitives";
import { frustumStrip } from "../controlPoints";
import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, ObjectTypeId } from "../registry";
import { sdPolygon, sdSegment } from "../sdf";
import { triBary } from "../tri";
import type { FieldSample, ObjectInstance } from "../types";
import { clamp, v2 } from "../vec";

/**
 * Plateau — a base polygon at ground level and an independently editable top rim at full height. The
 * slope between them is a parameter-paired LOFT: base-ring vertex i pairs with top-ring vertex i (use
 * the same anchor count), and each side lofts as a flat trapezoid, height ramping 0 (base) -> 1 (top)
 * shaped by `profile`. Seams fall on the natural corner edges, not the polygon's medial axis. A single
 * top vertex fans to an apex (a pyramid); the distance ramp is only the fallback for points no slope
 * triangle covers. (Plateau and Pyramid are palette presets. Mesa used to share this loft but now
 * blends soft ring distances instead — see plateauVector.ts.)
 *
 * The rims may CROSS: dragging top-rim vertices past the base ring reads as viewing the frustum from
 * an angle rather than top-down. The rules ("angled view"): the top polygon always renders flat at
 * full height and hides whatever is under it (the away-facing slope), while every side face renders
 * its loft wherever its quad reaches — even outside the base ring — with the highest face winning
 * where quads overlap. The footprint is therefore the union of both rings and all face triangles,
 * not the base ring alone.
 */

/** Barycentric height inside triangle abc (corner heights ha/hb/hc); null if p is outside it.
 *  Same containment (incl. the shared-edge tolerance) as the mesh field — one triBary for both.
 *  Exported for Mesa's crossed-rim skirt (the baked-ring loft outside both rings). */
export function triHeight(p: Vector2, a: Vector2, b: Vector2, c: Vector2, ha: number, hb: number, hc: number): number | null {
  const bc = triBary(p, a, b, c);
  return bc === null ? null : ha + bc.u * (hb - ha) + bc.v * (hc - ha);
}

/** Two-ring loft height field (base + top, split at ringSplit). */
export function plateauEval(p: Vector2, object: ObjectInstance): FieldSample {
  const h = 24;
  const profile = enumParam(object, "profile") as ProfileKind;
  const cps = object.controlPoints;
  const nB = object.ringSplit ?? (cps.length >> 1);
  const outer = cps.slice(0, nB);
  const inner = cps.slice(nB);
  const sdB = sdPolygon(p, outer);
  const sdT = sdPolygon(p, inner);
  // the top polygon hides everything under it, wherever it sits relative to the base ring
  if (sdT <= 0) return { height: h * applyProfile(profile, 1, 1), sd: Math.min(sdB, sdT) };
  // side faces: walk the whole paired trapezoid strip (base[i] -> top[i]); a face renders wherever
  // its triangles reach — including outside the base ring (a crossed rim folds the face over, it
  // stays visible) — and the highest face wins where quads overlap. Each triangle also feeds the
  // footprint SDF, so coverage follows the faces instead of stopping at the base ring.
  const ring = (r: number, idx: number): Vector2 => (r === 0 ? outer[idx]! : inner[idx]!);
  let t = 0;
  let hitFace = false;
  let sdF = Infinity;
  for (const [a, b, c] of frustumStrip(nB, inner.length)) {
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
  if (!hitFace) {
    // SDF-ramp fallback for base-interior points no triangle covers (degenerate / non-convex rings)
    if (sdB >= 0) return { height: 0, sd };
    t = clamp(sdB / Math.min(sdB - sdT, -1e-6), 0, 1);
  }
  return { height: h * applyProfile(profile, clamp(t, 0, 1), 1), sd };
}

/** The Plateau WGSL body under `fn`. params: 13=profile; cps: base ring (nB = rec(2)) then top rim.
 *  Mirrors plateauEval: top polygon hides, faces render wherever their triangles reach (highest
 *  wins) and feed the footprint SDF, distance-ramp fallback for uncovered base-interior points. */
export function plateauWgsl(fn: string): string {
  return /* wgsl */ `
fn ${fn}(p: vec2f, base: u32) -> vec2f {
  let h = 24.0;
  let prof = u32(rec(base, SLOT_PARAM0));
  let cs = u32(rec(base, SLOT_CP_START));
  let nB = u32(rec(base, SLOT_RING));
  let nT = u32(rec(base, SLOT_CP_COUNT)) - nB;
  let sdB = sd_polygon(p, cs, nB);
  let sdT = sd_polygon(p, cs + nB, nT);
  if (sdT <= 0.0) { return vec2f(h * apply_profile(prof, 1.0, 1.0), min(sdB, sdT)); }
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
  if (!hitFace) {
    if (sdB >= 0.0) { return vec2f(0.0, sd); }
    t = clamp(sdB / min(sdB - sdT, -1e-6), 0.0, 1.0);
  }
  return vec2f(h * apply_profile(prof, clamp(t, 0.0, 1.0), 1.0), sd);
}
`;
}

export const Plateau = defineObjectType({
  id: ObjectTypeId.Plateau,
  name: "Plateau",
  category: "Shapes",
  params: {
    profile: { type: "enum", options: PROFILE_KINDS, default: "linear" },
  },
  nominalHeight: 24,
  controlPoints: {
    kind: "rings",
    min: 3,
    default: [
      // base ring
      v2(-32, -32),
      v2(32, -32),
      v2(32, 32),
      v2(-32, 32),
      // top rim (full height inside this)
      v2(-20, -20),
      v2(20, -20),
      v2(20, 20),
      v2(-20, 20),
    ],
  },
  wgsl: plateauWgsl("shape_plateau"),
  eval: plateauEval,
});
