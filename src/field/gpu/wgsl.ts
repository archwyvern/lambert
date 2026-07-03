import { allObjectTypes } from "../registry";

/**
 * The ONE authoritative record-slot layout — f32 offsets into a packed object record. pack.ts writes
 * by these names, and the WGSL reads matching `SLOT_*` consts generated from this same map (see
 * SLOT_CONSTS_WGSL), so renumbering a slot propagates to both sides instead of needing ~15 files
 * hand-mirrored (the class of drift that let a magic-index bug ship before). PARAM0..7 is an 8-slot
 * region for a type's params AND, for Contour, its hole counts packed right after — it MUST
 * end before ELEVATION.
 */
export const RECORD_SLOT = {
  TYPE: 0, // gpuTypeIndex (fold dispatch)
  OP: 1, // 0 = raise/max, 1 = carve
  RING: 2, // base-ring count for rings objects (ringSplit)
  TALLNESS: 3, // composed extrude multiplier
  INV_A: 4, INV_B: 5, INV_C: 6, INV_D: 7, INV_E: 8, INV_F: 9, // inverse affine (world -> local)
  SCALE: 10, // forward scale hint (sd px scaling)
  CP_START: 11, // first control point / bezier anchor index
  CP_COUNT: 12, // control-point / anchor count
  PARAM0: 13, PARAM1: 14, PARAM2: 15, PARAM3: 16, PARAM4: 17, PARAM5: 18, PARAM6: 19, PARAM7: 20,
  ELEVATION: 21, // composed base elevation (post-extrude add)
  TRI_START: 22, // mesh: first vec4 of its triangles | adjust: first vec2 of its transform stream | middle-pillow: max soft distance
  TRI_COUNT: 23, // mesh: triangle count | adjust: transform count
  MASK_START: 24, // first mask loop index
  MASK_COUNT: 25, // mask loop count
  CLOSED: 26, // analytic path is a closed loop
  OPACITY: 27, // fold-contribution weight 0..1 (1 = full effect)
  // world-space footprint AABB (conservative, influence-padded): the fold's per-object cull box.
  // Cost model: without it every fragment/vertex evaluates EVERY object's full SDF (dense outline
  // loops, Pillow's boundary integral) — O(pixels x objects x outlinePoints).
  AABB_MIN_X: 28, AABB_MIN_Y: 29, AABB_MAX_X: 30, AABB_MAX_Y: 31,
} as const;

export const PARAMS_OFFSET = RECORD_SLOT.PARAM0; // 13
export const MAX_PARAMS = RECORD_SLOT.ELEVATION - RECORD_SLOT.PARAM0; // 8: params (+holes) must end before elevation
export const RECORD_F32 = RECORD_SLOT.AABB_MAX_Y + 1; // 32 f32 per record (8 vec4s)

// WGSL mirror of RECORD_SLOT, generated so the two can't drift: emitted into FIELD_LIB, referenced by
// every object's shader as `rec(base, SLOT_*)` instead of a bare integer literal.
const SLOT_CONSTS_WGSL = Object.entries(RECORD_SLOT)
  .map(([k, v]) => `const SLOT_${k}: u32 = ${v}u;`)
  .join("\n");

// Fold-compute-only bindings: the per-tile uniforms and the storage-texture output. The composite
// fragment does NOT include these (it has its own uniforms + a diffuse texture instead).
const FOLD_IO = /* wgsl */ `
struct Uniforms {
  width: u32,
  height: u32,
  shapeCount: u32,
  originX: f32,
  originY: f32,
  step: f32, // doc px per output px (1 for doc-res tiles)
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(3) var outField: texture_storage_2d<rg32float, write>;
`;

// Shared field library: object buffers + all eval functions + fold_at(). Included by BOTH the fold
// compute shader and the 2D composite fragment so the editor evaluates the exact same field math.
const FIELD_LIB = /* wgsl */ `
@group(0) @binding(1) var<storage, read> records: array<f32>;
@group(0) @binding(2) var<storage, read> points: array<vec2f>;
// mesh-plane triangles: 2 vec4 per vertex (pos x,y,height,gradX then gradY,_,_,_), 3 verts/triangle
@group(0) @binding(4) var<storage, read> meshTris: array<vec4f>;
// per-object trim masks: header vec4(vertStart, vertCount, flags, scopeId) where flags = mode(bit0:
// 1=cut) + space(bit1: 2=follow/local) + hard(bit2: 4=exact step, no AA — mirror seam clip), and
// scopeId groups loops (0 = object's own, 1+ = ancestor group masks). maskVerts holds each loop's
// baked closed polygon (vec2, local if follow else world).
@group(0) @binding(6) var<storage, read> maskLoops: array<vec4f>;
@group(0) @binding(7) var<storage, read> maskVerts: array<vec2f>;

const RECORD: u32 = ${RECORD_F32}u;
${SLOT_CONSTS_WGSL}

fn rec(base: u32, i: u32) -> f32 { return records[base + i]; }

// slots 4..9 hold the inverse affine (world -> object-local): local = M_inv * p + t_inv.
fn to_local(base: u32, p: vec2f) -> vec2f {
  return vec2f(
    rec(base, SLOT_INV_A) * p.x + rec(base, SLOT_INV_B) * p.y + rec(base, SLOT_INV_E),
    rec(base, SLOT_INV_C) * p.x + rec(base, SLOT_INV_D) * p.y + rec(base, SLOT_INV_F),
  );
}

fn combine_height(op: u32, bigH: f32, h: f32) -> f32 {
  if (op == 1u) { return min(bigH, bigH - h); } // carve
  if (op == 2u) { return h; } // replace (stencil: this object's surface wins outright)
  return max(bigH, h); // max (clip)
}

fn influence(sd: f32) -> f32 {
  let t = clamp(0.5 - sd, 0.0, 1.0); // box-filter coverage centered on the edge (no 1px bleed)
  return t * t * (3.0 - 2.0 * t);
}

// kind indices MUST match PROFILE_KINDS in profiles.ts (round=0, linear=1, cove=2, smooth=3) — pack.ts
// derives them via indexOf. Keep this switch and that array in lockstep (mirrors applyProfile CPU-side).
fn apply_profile(kind: u32, inside: f32, width: f32) -> f32 {
  if (width <= 0.0) { return select(0.0, 1.0, inside > 0.0); }
  let t = clamp(inside / width, 0.0, 1.0);
  switch kind {
    case 0u: { return sqrt(t * (2.0 - t)); }       // round
    case 1u: { return t; }                          // linear
    case 2u: { return 1.0 - sqrt(1.0 - t * t); }    // cove
    default: { return t * t * (3.0 - 2.0 * t); }    // smooth
  }
}

// Barycentric height inside triangle abc (corner heights ha/hb/hc); .y = 1 if p is inside, else 0.
// Shared by the Plateau / Mesa slope-band loft.
fn plateau_tri(p: vec2f, a: vec2f, b: vec2f, c: vec2f, ha: f32, hb: f32, hc: f32) -> vec2f {
  let det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (abs(det) < 1e-9) { return vec2f(0.0, 0.0); }
  let u = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
  let v = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
  if (u < -1e-4 || v < -1e-4 || u + v > 1.0001) { return vec2f(0.0, 0.0); }
  return vec2f(ha + u * (hb - ha) + v * (hc - ha), 1.0);
}

// Exact per-segment ∫ ds/d⁴ of the soft-boundary integral (mirrors segmentInv4 in field/softDist.ts
// — see the derivation there). Shared by Pillow (interior inflation) and Mesa (two-ring slope).
fn soft_seg_inv(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let e = b - a;
  let len = length(e);
  if (len < 1e-6) { return 0.0; }
  let w = p - a;
  let proj = dot(w, e) / len;
  let h2 = max(dot(w, w) - proj * proj, 0.0) + 0.25;
  let h = sqrt(h2);
  let u1 = len - proj;
  let u0 = -proj;
  let f1 = u1 / (2.0 * h2 * (u1 * u1 + h2)) + atan(u1 / h) / (2.0 * h2 * h);
  let f0 = u0 / (2.0 * h2 * (u0 * u0 + h2)) + atan(u0 / h) / (2.0 * h2 * h);
  return f1 - f0;
}

// ∮ over one closed ring of baked points.
fn soft_ring_inv(p: vec2f, start: u32, count: u32) -> f32 {
  var inv = 0.0;
  for (var j = 0u; j < count; j = j + 1u) {
    let a = points[start + j];
    let b = points[start + select(j + 1u, 0u, j + 1u >= count)];
    inv = inv + soft_seg_inv(p, a, b);
  }
  return inv;
}

// The C-inf soft distance to one ring: (∮ ds/d⁴)^(-1/3).
fn soft_ring_dist(p: vec2f, start: u32, count: u32) -> f32 {
  return pow(soft_ring_inv(p, start, count), -0.33333333);
}

// One adjustment-layer transform f(H). Kind indices MUST match ADJUSTMENT_KINDS in adjustments.ts
// (add=0, multiply=1, clamp=2, curve=3, ramp=4) — pack.ts derives them via the array order. Params
// arrive as two packed vec2s ((p0,p1), (p2,p3)); pl is the REGION-local point for positional kinds.
fn adjust_apply(kind: u32, H: f32, a: vec2f, b: vec2f, pl: vec2f, base: u32) -> f32 {
  switch kind {
    case 0u: { return H + a.x; }             // add (raise / lower)
    case 1u: { return H * a.x; }             // multiply
    case 2u: { return clamp(H, a.x, a.y); }  // clamp
    case 3u: {                                // curve: levels + gamma over [low, high]
      let span = max(a.y - a.x, 1e-6);
      let t = clamp((H - a.x) / span, 0.0, 1.0);
      return a.x + span * pow(t, max(b.x, 1e-3));
    }
    default: {                                // ramp: 0 -> depth across the region along angle
      let ang = a.x * 0.017453292519943295;
      let dir = vec2f(cos(ang), sin(ang));
      let cs = u32(rec(base, SLOT_CP_START));
      let nB = u32(rec(base, SLOT_RING)); // outer ring only spans the ramp
      var minP = 1e30;
      var maxP = -1e30;
      for (var i = 0u; i < nB; i = i + 1u) {
        let t2 = dot(points[cs + i], dir);
        minP = min(minP, t2);
        maxP = max(maxP, t2);
      }
      let t = clamp((dot(pl, dir) - minP) / max(maxP - minP, 1e-6), 0.0, 1.0);
      return H + a.y * t;
    }
  }
}

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

fn sd_polygon(p: vec2f, start: u32, count: u32) -> f32 {
  if (count == 1u) { return length(p - points[start]); }                        // point (cone apex)
  if (count == 2u) { return sd_segment(p, points[start], points[start + 1u]); } // segment (ridge top)
  var d = dot(p - points[start], p - points[start]);
  var s = 1.0;
  var j = count - 1u;
  for (var i = 0u; i < count; i = i + 1u) {
    let vi = points[start + i];
    let vj = points[start + j];
    let e = vj - vi;
    let w = p - vi;
    let t = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    let b = w - e * t;
    d = min(d, dot(b, b));
    let c0 = p.y >= vi.y;
    let c1 = p.y < vj.y;
    let c2 = e.x * w.y > e.y * w.x;
    if ((c0 && c1 && c2) || (!c0 && !c1 && !c2)) { s = -s; }
    j = i;
  }
  return s * sqrt(d);
}

// inside/distance test for a mask loop (>= 3 baked verts) — mirror of sdf.ts sdPolygon's general
// winding branch, reading the maskVerts buffer instead of points.
fn sd_mask_polygon(start: u32, count: u32, p: vec2f) -> f32 {
  var d = dot(p - maskVerts[start], p - maskVerts[start]);
  var s = 1.0;
  var j = count - 1u;
  for (var i = 0u; i < count; i = i + 1u) {
    let vi = maskVerts[start + i];
    let vj = maskVerts[start + j];
    let e = vj - vi;
    let w = p - vi;
    let t = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    let b = w - e * t;
    d = min(d, dot(b, b));
    let c0 = p.y >= vi.y;
    let c1 = p.y < vj.y;
    let c2 = e.x * w.y > e.y * w.x;
    if ((c0 && c1 && c2) || (!c0 && !c1 && !c2)) { s = -s; }
    j = i;
  }
  return s * sqrt(d);
}

// combined trim coverage: keepCov * (1 - cutCov) within a scope, MULTIPLIED across scopes (group
// masks intersect the object's own). Mirrors maskOps.ts maskCoverage — follow loops test pLocal (sd
// scaled to canvas by distScale rec(10)), world loops test pWorld. Loops are scope-sorted (lane w).
fn mask_cover(base: u32, pWorld: vec2f, pLocal: vec2f) -> f32 {
  let loopStart = u32(rec(base, SLOT_MASK_START));
  let loopCount = u32(rec(base, SLOT_MASK_COUNT));
  if (loopCount == 0u) { return 1.0; }
  let dscale = rec(base, SLOT_SCALE);
  var total = 1.0;
  var keep = 0.0;
  var cut = 0.0;
  var hasKeep = false;
  var cur = i32(maskLoops[loopStart].w);
  for (var li = 0u; li < loopCount; li = li + 1u) {
    let h = maskLoops[loopStart + li];
    let scope = i32(h.w);
    if (scope != cur) {
      total = total * (select(1.0, keep, hasKeep) * (1.0 - cut));
      keep = 0.0;
      cut = 0.0;
      hasKeep = false;
      cur = scope;
    }
    let vstart = u32(h.x);
    let vcount = u32(h.y);
    let flags = u32(h.z);
    let isCut = (flags & 1u) == 1u;
    let follow = (flags & 2u) == 2u;
    let isHard = (flags & 4u) == 4u;
    let pt = select(pWorld, pLocal, follow);
    let scale = select(1.0, dscale, follow);
    let sd = sd_mask_polygon(vstart, vcount, pt) * scale;
    // +0.5: loop edge = outer boundary of the affected area (pen line sits on the mask edge, not mid-AA)
    let cov = select(influence(sd + 0.5), select(0.0, 1.0, sd <= 0.0), isHard); // hard = exact step (seam)
    if (isCut) { cut = max(cut, cov); }
    else { keep = max(keep, cov); hasKeep = true; }
  }
  total = total * (select(1.0, keep, hasKeep) * (1.0 - cut));
  return total;
}

// cubic Bézier point + derivatives (mirror bezier.ts) — the cable samples these per pixel
fn cubic_at(p0: vec2f, c0: vec2f, c1: vec2f, p1: vec2f, t: f32) -> vec2f {
  let u = 1.0 - t;
  return u * u * u * p0 + 3.0 * u * u * t * c0 + 3.0 * u * t * t * c1 + t * t * t * p1;
}
fn cubic_d1(p0: vec2f, c0: vec2f, c1: vec2f, p1: vec2f, t: f32) -> vec2f {
  let u = 1.0 - t;
  return 3.0 * u * u * (c0 - p0) + 6.0 * u * t * (c1 - c0) + 3.0 * t * t * (p1 - c1);
}
fn cubic_d2(p0: vec2f, c0: vec2f, c1: vec2f, p1: vec2f, t: f32) -> vec2f {
  let u = 1.0 - t;
  return 6.0 * u * (c1 - 2.0 * c0 + p0) + 6.0 * t * (p1 - 2.0 * c1 + c0);
}
// SMOOTH distance from p to a cubic segment: coarse scan for the nearest t, then Newton-refine
// the closest-point condition dot(B(t)-p, B'(t)) = 0. A smooth distance => smooth normals (no facets).
// Distance from p to a cubic segment. cutStart/cutEnd request a flat cap at that endpoint: the dome
// (the region whose nearest point IS the endpoint, and which sits beyond it) is removed locally —
// a Voronoi test, NOT an infinite half-plane (a half-plane slices off curved tube far from the end).
// Nearest distance AND its parameter t (for per-anchor radius interpolation). Returns vec2(dist, t).
fn cubic_dist_t(p: vec2f, p0: vec2f, c0: vec2f, c1: vec2f, p1: vec2f, cutStart: bool, cutEnd: bool) -> vec2f {
  // 16-sample bracket: enough to isolate the global nearest even when long tangents make the curve
  // loop/cusp and the distance-in-t has several local minima (a coarse 8-sample scan missed them).
  var bestT = 0.0;
  var bestD = 1e30;
  for (var s = 0u; s <= 16u; s = s + 1u) {
    let t = f32(s) / 16.0;
    let q = cubic_at(p0, c0, c1, p1, t);
    let dd = dot(q - p, q - p);
    if (dd < bestD) { bestD = dd; bestT = t; }
  }
  var t = bestT;
  for (var it = 0u; it < 4u; it = it + 1u) {
    let B = cubic_at(p0, c0, c1, p1, t);
    let d1 = cubic_d1(p0, c0, c1, p1, t);
    let d2 = cubic_d2(p0, c0, c1, p1, t);
    let fp = dot(d1, d1) + dot(B - p, d2);
    if (abs(fp) > 1e-5) { t = clamp(t - dot(B - p, d1) / fp, 0.0, 1.0); }
  }
  // flat cap: nearest pinned at this end (t at the boundary) AND strictly beyond it -> outside.
  if (cutEnd && t > 0.9999 && dot(p - p1, p1 - c1) > 0.0) { return vec2f(1e30, t); }
  if (cutStart && t < 0.0001 && dot(p - p0, c0 - p0) < 0.0) { return vec2f(1e30, t); }
  // guard: a diverging Newton step must never make it worse than the coarse bracket (that produced
  // the spiky garbage normals on long tangents) — keep whichever distance is smaller.
  let bn = cubic_at(p0, c0, c1, p1, t);
  let dn = dot(bn - p, bn - p);
  if (dn <= bestD) { return vec2f(sqrt(dn), t); }
  return vec2f(sqrt(bestD), bestT);
}

fn cubic_dist(p: vec2f, p0: vec2f, c0: vec2f, c1: vec2f, p1: vec2f, cutStart: bool, cutEnd: bool) -> f32 {
  return cubic_dist_t(p, p0, c0, c1, p1, cutStart, cutEnd).x;
}

// Triangulated height-field eval for Mesh: barycentric height in the
// triangle under p (blended toward Phong by smoothness, the mesh's first param), else sd to nearest edge.
fn shape_meshfield(p: vec2f, base: u32) -> vec2f {
  let sm = rec(base, SLOT_PARAM0);
  let triStart = u32(rec(base, SLOT_TRI_START));
  let triCount = u32(rec(base, SLOT_TRI_COUNT));
  for (var t = 0u; t < triCount; t = t + 1u) {
    let o = triStart + t * 6u;
    let a = meshTris[o];
    let b = meshTris[o + 2u];
    let c = meshTris[o + 4u];
    let det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (abs(det) < 1e-9) { continue; }
    let uu = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
    let vv = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
    if (uu >= -1e-4 && vv >= -1e-4 && uu + vv <= 1.0001) {
      let ww = 1.0 - uu - vv;
      let hL = ww * a.z + uu * b.z + vv * c.z;
      if (sm <= 0.0) { return vec2f(hL, -1.0); }
      let pa = a.z + a.w * (p.x - a.x) + meshTris[o + 1u].x * (p.y - a.y);
      let pb = b.z + b.w * (p.x - b.x) + meshTris[o + 3u].x * (p.y - b.y);
      let pc = c.z + c.w * (p.x - c.x) + meshTris[o + 5u].x * (p.y - c.y);
      let hP = ww * pa + uu * pb + vv * pc;
      return vec2f(hL + sm * (hP - hL), -1.0);
    }
  }
  var d = 1e9;
  for (var t = 0u; t < triCount; t = t + 1u) {
    let o = triStart + t * 6u;
    d = min(d, sd_segment(p, meshTris[o].xy, meshTris[o + 2u].xy));
    d = min(d, sd_segment(p, meshTris[o + 2u].xy, meshTris[o + 4u].xy));
    d = min(d, sd_segment(p, meshTris[o + 4u].xy, meshTris[o].xy));
  }
  return vec2f(0.0, d);
}
`;

// The ordered fold over all objects at one point -> vec2f(height, mask). Shared by fold + composite.
const FOLD_AT = /* wgsl */ `
fn fold_at(p: vec2f, count: u32) -> vec2f {
  var bigH = 0.0;
  var bigM = 0.0;
  var covered = false; // has any object hard-covered this pixel yet?
  for (var s = 0u; s < count; s = s + 1u) {
    let base = s * RECORD;
    // AABB cull: outside the object's (influence-padded) world footprint its contribution is
    // exactly zero (influence(sd)=0), so skipping is a pure win — no SDF, no mask CSG
    if (p.x < rec(base, SLOT_AABB_MIN_X) || p.x > rec(base, SLOT_AABB_MAX_X) ||
        p.y < rec(base, SLOT_AABB_MIN_Y) || p.y > rec(base, SLOT_AABB_MAX_Y)) { continue; }
    let pl = to_local(base, p);
    let smp = eval_shape(u32(rec(base, SLOT_TYPE)), pl, base);
    let sd = smp.y * rec(base, SLOT_SCALE);
    // per-object opacity scales the whole contribution: the mask influence AND the height step below
    let alpha = rec(base, SLOT_OPACITY);
    // edge coverage: AA objects get the box-filter ramp; the default is a HARD step at sd < 0
    // (crisp sprite silhouettes). bit1 of SLOT_CLOSED carries the flag (see pack.ts).
    let aa = (u32(rec(base, SLOT_CLOSED)) & 2u) != 0u;
    var inf = select(select(0.0, 1.0, sd < 0.0), influence(sd), aa) * alpha;
    inf = inf * mask_cover(base, p, pl);
    if (inf <= 0.0) { continue; }
    let op = u32(rec(base, SLOT_OP));
    if (op == 3u) {
      // adjustment layer: transform the ACCUMULATED height inside its region (coverage-gated
      // blend, out = mix(H, f(H), strength * coverage)); no height or mask contribution of its own
      let n = u32(rec(base, SLOT_TRI_COUNT));
      var ai = u32(rec(base, SLOT_TRI_START));
      for (var k = 0u; k < n; k = k + 1u) {
        let head = points[ai];
        bigH = mix(bigH, adjust_apply(u32(head.x), bigH, points[ai + 1u], points[ai + 2u], pl, base), head.y * inf);
        ai = ai + 3u;
      }
      continue;
    }
    let h = rec(base, SLOT_ELEVATION) + smp.x * rec(base, SLOT_TALLNESS); // elevation + extrude
    // the FIRST object (a non-carve "max" object) to cover a pixel SETS the surface, so it can go below
    // the ground plane — negative Z is allowed. Later overlapping objects, and carve objects (which
    // subtract from the ground), always combine.
    let combined = select(combine_height(op, bigH, h), h, !covered && op != 1u);
    // mask = footprint COVERAGE (AA edge + trim masks), not height change — so a flat region (z=0, or
    // the low end of a slope) still writes its normal instead of vanishing (see evalCpu.ts).
    bigM = max(bigM, inf);
    // height is a HARD step at the footprint boundary so a vertical wall stays a wall — otherwise
    // the 1px influence ramp reads as a slope at the silhouette and minmod can't flatten it. Opacity
    // lerps the step toward the accumulated surface (0.5 = half effect).
    bigH = select(bigH, mix(bigH, combined, alpha), sd < 0.0);
    covered = covered || (sd < 0.0);
  }
  return vec2f(bigH, bigM);
}
`;

/** The WGSL fn name for an object type's SDF. Derived from the display name (not the GUID id) so the
 *  generated shader + any compile error stays readable; each type's `wgsl` field declares this name. */
export function objectWgslFn(name: string): string {
  return `shape_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function dispatchSwitch(): string {
  const cases = allObjectTypes()
    .filter((t) => t.wgsl)
    .map((t, i) => {
      const fn = objectWgslFn(t.name);
      return i === 0
        ? `    default: { return ${fn}(p, base); }`
        : `    case ${i}u: { return ${fn}(p, base); }`;
    });
  // default must come last in WGSL switch; emit cases 1..n then default (type 0)
  return `
fn eval_shape(typeIndex: u32, p: vec2f, base: u32) -> vec2f {
  switch typeIndex {
${cases.slice(1).join("\n")}
${cases[0] ?? "    default: { return vec2f(0.0, 1e30); }"}
  }
}
`;
}

const FOLD_MAIN = /* wgsl */ `
@compute @workgroup_size(8, 8)
fn fold(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.width || gid.y >= u.height) { return; }
  let p = vec2f((f32(gid.x) + 0.5) * u.step + u.originX, (f32(gid.y) + 0.5) * u.step + u.originY);
  let r = fold_at(p, u.shapeCount);
  textureStore(outField, vec2u(gid.xy), vec4f(r.x, r.y, 0.0, 0.0));
}
`;

/** Shared field-eval library (buffers + object fns + fold_at), included by fold + composite. */
export function buildFieldLibWgsl(): string {
  const shapeFns = allObjectTypes()
    .filter((t) => t.wgsl)
    .map((t) => t.wgsl!)
    .join("\n");
  return FIELD_LIB + shapeFns + dispatchSwitch() + FOLD_AT;
}

/** Assemble the fold compute module from the registry. Deterministic given import order. */
export function buildFoldWgsl(): string {
  return FOLD_IO + buildFieldLibWgsl() + FOLD_MAIN;
}

/** typeIndex assignment used by pack.ts — must match dispatchSwitch ordering. */
export function gpuTypeIndex(typeId: string): number {
  const idx = allObjectTypes()
    .filter((t) => t.wgsl)
    .findIndex((t) => t.id === typeId);
  if (idx < 0) throw new Error(`object type ${typeId} has no wgsl registration`);
  return idx;
}

export const NORMAL_WGSL = /* wgsl */ `
struct NormalUniforms {
  width: u32,
  height: u32,
  slopeScale: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> nu: NormalUniforms;
@group(0) @binding(1) var fieldTex: texture_2d<f32>;
@group(0) @binding(2) var outNormal: texture_storage_2d<rgba32float, write>;

fn height_at(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(nu.width) - 1);
  let cy = clamp(y, 0, i32(nu.height) - 1);
  return textureLoad(fieldTex, vec2i(cx, cy), 0).r;
}

// minmod of the two one-sided slopes — keeps real slopes, drops cliffs to flat so a vertical wall
// is invisible like an orthographic bake. Must match deriveNormals() in normals.ts (CPU) exactly.
fn minmod(a: f32, b: f32) -> f32 {
  if (a * b <= 0.0) { return 0.0; }
  return select(b, a, abs(a) < abs(b));
}

@compute @workgroup_size(8, 8)
fn normals(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= nu.width || gid.y >= nu.height) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let c = height_at(x, y);
  let dx = minmod(height_at(x + 1, y) - c, c - height_at(x - 1, y)) * nu.slopeScale;
  let dy = minmod(height_at(x, y + 1) - c, c - height_at(x, y - 1)) * nu.slopeScale;
  let inv = inverseSqrt(dx * dx + dy * dy + 1.0);
  let m = textureLoad(fieldTex, vec2i(x, y), 0).g;
  textureStore(outNormal, vec2u(gid.xy), vec4f(-dx * inv, -dy * inv, inv, m));
}
`;

export function buildNormalWgsl(): string {
  return NORMAL_WGSL;
}
