import { Vector2 } from "@carapace/primitives";
import { frustumStrip } from "../controlPoints";
import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineObjectType, enumParam, ObjectTypeId } from "../registry";
import { sdPolygon } from "../sdf";
import { triBary } from "../tri";
import type { FieldSample, ObjectInstance } from "../types";
import { clamp, v2 } from "../vec";

/**
 * Plateau — a base polygon at ground level and an independently editable top rim at full height. The
 * slope between them is a parameter-paired LOFT: base-ring vertex i pairs with top-ring vertex i (use
 * the same anchor count), and each side lofts as a flat trapezoid, height ramping 0 (base) -> 1 (top)
 * shaped by `profile`. Seams fall on the natural corner edges, not the polygon's medial axis. A single
 * top vertex fans to an apex (a pyramid); the distance ramp is only the fallback for points no slope
 * triangle covers. (Plateau and Pyramid are palette presets; Mesa shares this eval/WGSL,
 * lofting two baked Bézier rings.)
 */

/** Barycentric height inside triangle abc (corner heights ha/hb/hc); null if p is outside it.
 *  Same containment (incl. the shared-edge tolerance) as the mesh field — one triBary for both. */
function triHeight(p: Vector2, a: Vector2, b: Vector2, c: Vector2, ha: number, hb: number, hc: number): number | null {
  const bc = triBary(p, a, b, c);
  return bc === null ? null : ha + bc.u * (hb - ha) + bc.v * (hc - ha);
}

/** Two-ring loft height field (base + top, split at ringSplit). Shared by Plateau (straight rings) and
 *  Mesa (rings baked from two closed Bézier loops). */
export function plateauEval(p: Vector2, object: ObjectInstance): FieldSample {
  const h = 24;
  const profile = enumParam(object, "profile") as ProfileKind;
  const cps = object.controlPoints;
  const nB = object.ringSplit ?? (cps.length >> 1);
  const outer = cps.slice(0, nB);
  const inner = cps.slice(nB);
  const sdB = sdPolygon(p, outer);
  const sdT = sdPolygon(p, inner);
  let t = 0;
  if (sdT <= 0) {
    t = 1; // inside the top rim
  } else if (sdB < 0) {
    // slope band: loft the paired trapezoid strip (base[i] -> top[i]); the SDF ramp is the fallback
    // for points no triangle covers (degenerate / non-convex rings).
    t = clamp(sdB / Math.min(sdB - sdT, -1e-6), 0, 1);
    const ring = (r: number, idx: number): Vector2 => (r === 0 ? outer[idx]! : inner[idx]!);
    for (const [a, b, c] of frustumStrip(nB, inner.length)) {
      const hit = triHeight(p, ring(a[0], a[1]), ring(b[0], b[1]), ring(c[0], c[1]), a[0], b[0], c[0]);
      if (hit !== null) {
        t = hit;
        break;
      }
    }
  }
  return { height: h * applyProfile(profile, t, 1), sd: sdB };
}

/** The shared WGSL body under `fn`. params: 13=profile; cps: base ring (nB = rec(2)) then top rim.
 *  Mirrors plateauEval: walk the paired strip, barycentric height per triangle, distance-ramp fallback. */
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
  var t = 0.0;
  if (sdT <= 0.0) {
    t = 1.0;
  } else if (sdB < 0.0) {
    t = clamp(sdB / min(sdB - sdT, -1e-6), 0.0, 1.0); // fallback
    var i = 0u;
    var j = 0u;
    let steps = nB + nT;
    for (var k = 0u; k < steps; k = k + 1u) {
      let advanceOuter = (j >= nT) || (i < nB && (f32(i + 1u) / f32(nB) <= f32(j + 1u) / f32(nT)));
      if (advanceOuter) {
        let oa = points[cs + (i % nB)];
        let ob = points[cs + ((i + 1u) % nB)];
        let ic = points[cs + nB + (j % nT)];
        let r = plateau_tri(p, oa, ob, ic, 0.0, 0.0, 1.0);
        if (r.y > 0.5) { t = r.x; break; }
        i = i + 1u;
      } else {
        let oa = points[cs + (i % nB)];
        let ia = points[cs + nB + (j % nT)];
        let ib = points[cs + nB + ((j + 1u) % nT)];
        let r = plateau_tri(p, oa, ia, ib, 0.0, 1.0, 1.0);
        if (r.y > 0.5) { t = r.x; break; }
        j = j + 1u;
      }
    }
  }
  return vec2f(h * apply_profile(prof, t, 1.0), sdB);
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
