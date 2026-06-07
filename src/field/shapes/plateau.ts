import { applyProfile, PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam } from "../registry";
import { sdPolygon } from "../sdf";
import { clamp, Vec2, v2 } from "../vec";

/**
 * Frustum: a base ring at ground level and an independently draggable top rim at full
 * height. The slope band is the actual lateral faces — quad (base i, base i+1, top i+1,
 * top i) per side, split into two triangles, height by barycentric interpolation — so
 * each base vertex connects to its top vertex with a sharp crease, exactly like a mesh.
 * The SDF ratio remains only as a fallback for degenerate configurations (top ring
 * dragged outside the base, coincident rings).
 */

/** Barycentric height inside triangle abc with corner heights ha/hb/hc; null if outside. */
function triHeight(p: Vec2, a: Vec2, b: Vec2, c: Vec2, ha: number, hb: number, hc: number): number | null {
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
  let n = u32(rec(base, 12u)) / 2u;
  let sdB = sd_polygon(p, cs, n);
  let sdT = sd_polygon(p, cs + n, n);
  var t = 0.0;
  if (sdT <= 0.0) {
    t = 1.0; // inside the top rim
  } else if (sdB < 0.0) {
    t = clamp(sdB / min(sdB - sdT, -1e-6), 0.0, 1.0); // fallback for degenerate faces
    for (var i = 0u; i < n; i = i + 1u) {
      let j = (i + 1u) % n;
      let bi = points[cs + i];
      let bj = points[cs + j];
      let ti = points[cs + n + i];
      let tj = points[cs + n + j];
      let r1 = plateau_tri(p, bi, bj, ti, 0.0, 0.0, 1.0);
      if (r1.y > 0.5) { t = r1.x; break; }
      let r2 = plateau_tri(p, bj, tj, ti, 0.0, 1.0, 1.0);
      if (r2.y > 0.5) { t = r2.x; break; }
    }
  }
  return vec2f(h * apply_profile(prof, t, 1.0), sdB);
}
`,
  eval(p, shape) {
    const h = 24;
    const profile = enumParam(shape, "profile") as ProfileKind;
    const cps = shape.controlPoints;
    const n = cps.length >> 1;
    const sdB = sdPolygon(p, cps.slice(0, n));
    const sdT = sdPolygon(p, cps.slice(n));
    let t = 0;
    if (sdT <= 0) {
      t = 1; // inside the top rim
    } else if (sdB < 0) {
      t = clamp(sdB / Math.min(sdB - sdT, -1e-6), 0, 1); // fallback for degenerate faces
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const r1 = triHeight(p, cps[i]!, cps[j]!, cps[n + i]!, 0, 0, 1);
        if (r1 !== null) {
          t = r1;
          break;
        }
        const r2 = triHeight(p, cps[j]!, cps[n + j]!, cps[n + i]!, 0, 1, 1);
        if (r2 !== null) {
          t = r2;
          break;
        }
      }
    }
    return { height: h * applyProfile(profile, t, 1), sd: sdB };
  },
});
