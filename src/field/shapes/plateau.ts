import { frustumStrip } from "../controlPoints";
import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam } from "../registry";
import { sdPolygon } from "../sdf";
import { Vector2 } from "@carapace/primitives";
import { clamp, v2 } from "../vec";

/**
 * Frustum: a base ring at ground level and an independently draggable top rim at full height.
 * The slope band is triangulated as a two-pointer strip between the rings (see frustumStrip):
 * walk both loops by normalized position, emitting a triangle per step — base verts at height
 * 0, top verts at height 1, height inside a triangle by barycentric interpolation. This handles
 * ANY inner/outer counts (equal counts give the quad-per-side split; e.g. 4 outer + 5 inner fans
 * the extra vertex). The SDF distance ramp between the rings is the fallback for points no
 * triangle covers (degenerate / non-convex rings, top dragged outside the base).
 */

/** Barycentric height inside triangle abc with corner heights ha/hb/hc; null if outside. */
function triHeight(p: Vector2, a: Vector2, b: Vector2, c: Vector2, ha: number, hb: number, hc: number): number | null {
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(det) < 1e-9) return null;
  const u = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
  const v = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
  const eps = -1e-4; // tolerant on shared edges so adjacent faces always cover the seam
  if (u < eps || v < eps || u + v > 1 - eps) return null;
  return ha + u * (hb - ha) + v * (hc - ha);
}

export const Plateau = defineShapeType({
  id: "plateau",
  name: "Plateau",
  category: "Primitives",
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
  // params: 13=profile(enum idx); tallness = 24 * scale.z. cps: base ring then top rim
  wgsl: /* wgsl */ `
fn plateau_tri(p: vec2f, a: vec2f, b: vec2f, c: vec2f, ha: f32, hb: f32, hc: f32) -> vec2f {
  let det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (abs(det) < 1e-9) { return vec2f(0.0, 0.0); }
  let u = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
  let v = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
  if (u < -1e-4 || v < -1e-4 || u + v > 1.0001) { return vec2f(0.0, 0.0); }
  return vec2f(ha + u * (hb - ha) + v * (hc - ha), 1.0);
}

fn shape_plateau(p: vec2f, base: u32) -> vec2f {
  let h = 24.0;
  let prof = u32(rec(base, 13u));
  let cs = u32(rec(base, 11u));
  let nB = u32(rec(base, 2u));
  let nT = u32(rec(base, 12u)) - nB;
  let sdB = sd_polygon(p, cs, nB);
  let sdT = sd_polygon(p, cs + nB, nT);
  var t = 0.0;
  if (sdT <= 0.0) {
    t = 1.0; // inside the top rim
  } else if (sdB < 0.0) {
    // slope band: walk the two-ring strip triangulation (mirrors frustumStrip), barycentric
    // height per triangle. SDF ramp is the fallback for points no triangle covers.
    t = clamp(sdB / min(sdB - sdT, -1e-6), 0.0, 1.0);
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
`,
  eval(p, shape) {
    const h = 24;
    const profile = enumParam(shape, "profile") as ProfileKind;
    const cps = shape.controlPoints;
    const nB = shape.ringSplit ?? (cps.length >> 1);
    const outer = cps.slice(0, nB);
    const inner = cps.slice(nB);
    const sdB = sdPolygon(p, outer);
    const sdT = sdPolygon(p, inner);
    let t = 0;
    if (sdT <= 0) {
      t = 1; // inside the top rim
    } else if (sdB < 0) {
      // slope band: barycentric height inside the two-ring strip triangulation. The SDF ramp
      // is the fallback for points no triangle covers (degenerate / non-convex rings).
      t = clamp(sdB / Math.min(sdB - sdT, -1e-6), 0, 1);
      const ring = (r: number, idx: number): Vector2 => (r === 0 ? outer[idx]! : inner[idx]!);
      for (const [a, b, c] of frustumStrip(nB, inner.length).tris) {
        const hit = triHeight(p, ring(a[0], a[1]), ring(b[0], b[1]), ring(c[0], c[1]), a[0], b[0], c[0]);
        if (hit !== null) {
          t = hit;
          break;
        }
      }
    }
    return { height: h * applyProfile(profile, t, 1), sd: sdB };
  },
});
