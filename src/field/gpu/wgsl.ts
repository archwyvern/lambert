import { allShapeTypes } from "../registry";

export const RECORD_F32 = 26;
export const PARAMS_OFFSET = 13;
export const MAX_PARAMS = 8;

/** Record layout (f32 slots): see pack.ts — typeIndex, op, ringSplit, scaleZ, invAffine(a,b,c,d)
 *  = slots 4-7, invAffine translation(e,f) = slots 8-9, distScale, cpStart, cpCount, params[8],
 *  elevation, meshTriStart, meshTriCount, maskLoopStart, maskLoopCount. */

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

// Shared field library: shape buffers + all eval functions + fold_at(). Included by BOTH the fold
// compute shader and the 2D composite fragment so the editor evaluates the exact same field math.
const FIELD_LIB = /* wgsl */ `
@group(0) @binding(1) var<storage, read> records: array<f32>;
@group(0) @binding(2) var<storage, read> points: array<vec2f>;
// mesh-plane triangles: 2 vec4 per vertex (pos x,y,height,gradX then gradY,_,_,_), 3 verts/triangle
@group(0) @binding(4) var<storage, read> meshTris: array<vec4f>;
// per-shape trim masks: header vec4(vertStart, vertCount, flags, scopeId) where flags = mode(bit0:
// 1=cut) + space(bit1: 2=follow/local) + hard(bit2: 4=exact step, no AA — mirror seam clip), and
// scopeId groups loops (0 = shape's own, 1+ = ancestor group masks). maskVerts holds each loop's
// baked closed polygon (vec2, local if follow else world).
@group(0) @binding(6) var<storage, read> maskLoops: array<vec4f>;
@group(0) @binding(7) var<storage, read> maskVerts: array<vec2f>;

const RECORD: u32 = ${RECORD_F32}u;

fn rec(base: u32, i: u32) -> f32 { return records[base + i]; }

// slots 4..9 hold the inverse affine (world -> shape-local): local = M_inv * p + t_inv.
fn to_local(base: u32, p: vec2f) -> vec2f {
  return vec2f(
    rec(base, 4u) * p.x + rec(base, 5u) * p.y + rec(base, 8u),
    rec(base, 6u) * p.x + rec(base, 7u) * p.y + rec(base, 9u),
  );
}

fn combine_height(op: u32, bigH: f32, h: f32) -> f32 {
  if (op == 1u) { return min(bigH, bigH - h); } // carve
  return max(bigH, h); // max (clip)
}

fn influence(sd: f32) -> f32 {
  let t = clamp(0.5 - sd, 0.0, 1.0); // box-filter coverage centered on the edge (no 1px bleed)
  return t * t * (3.0 - 2.0 * t);
}

fn apply_profile(kind: u32, inside: f32, width: f32) -> f32 {
  if (width <= 0.0) { return select(0.0, 1.0, inside > 0.0); }
  let t = clamp(inside / width, 0.0, 1.0);
  switch kind {
    case 0u: { return t; }
    case 1u: { return t * t * (3.0 - 2.0 * t); }
    case 2u: { return sqrt(t * (2.0 - t)); }
    default: { return 1.0 - sqrt(1.0 - t * t); }
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
// masks intersect the shape's own). Mirrors maskOps.ts maskCoverage — follow loops test pLocal (sd
// scaled to canvas by distScale rec(10)), world loops test pWorld. Loops are scope-sorted (lane w).
fn mask_cover(base: u32, pWorld: vec2f, pLocal: vec2f) -> f32 {
  let loopStart = u32(rec(base, 24u));
  let loopCount = u32(rec(base, 25u));
  if (loopCount == 0u) { return 1.0; }
  let dscale = rec(base, 10u);
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

fn sd_ellipse(p: vec2f, r: vec2f) -> f32 {
  if (r.x == r.y) { return length(p) - r.x; }
  let k1 = length(p / r);
  let k2 = length(p / (r * r));
  return k1 * (k1 - 1.0) / max(k2, 1e-12);
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
fn cubic_dist(p: vec2f, p0: vec2f, c0: vec2f, c1: vec2f, p1: vec2f, cutStart: bool, cutEnd: bool) -> f32 {
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
  if (cutEnd && t > 0.9999 && dot(p - p1, p1 - c1) > 0.0) { return 1e30; }
  if (cutStart && t < 0.0001 && dot(p - p0, c0 - p0) < 0.0) { return 1e30; }
  // guard: a diverging Newton step must never make it worse than the coarse bracket (that produced
  // the spiky garbage normals on long tangents) — keep whichever distance is smaller.
  let bn = cubic_at(p0, c0, c1, p1, t);
  return sqrt(min(bestD, dot(bn - p, bn - p)));
}

// spine with a separate profile slope width (slopeW < halfW gives a flat-topped section)
fn shape_spine_s(p: vec2f, base: u32, h: f32, halfW: f32, slopeW: f32, prof: u32) -> vec2f {
  let cs = u32(rec(base, 11u));
  let cc = u32(rec(base, 12u));
  var d = 1e30;
  for (var i = 0u; i + 1u < cc; i = i + 1u) {
    d = min(d, sd_segment(p, points[cs + i], points[cs + i + 1u]));
  }
  let sd = d - halfW;
  return vec2f(h * apply_profile(prof, -sd, slopeW), sd);
}

fn shape_spine(p: vec2f, base: u32, h: f32, halfW: f32, prof: u32) -> vec2f {
  return shape_spine_s(p, base, h, halfW, halfW, prof);
}
`;

// The ordered fold over all shapes at one point -> vec2f(height, mask). Shared by fold + composite.
const FOLD_AT = /* wgsl */ `
fn fold_at(p: vec2f, count: u32) -> vec2f {
  var bigH = 0.0;
  var bigM = 0.0;
  var covered = false; // has any shape hard-covered this pixel yet?
  for (var s = 0u; s < count; s = s + 1u) {
    let base = s * RECORD;
    let pl = to_local(base, p);
    let smp = eval_shape(u32(rec(base, 0u)), pl, base);
    let sd = smp.y * rec(base, 10u);
    var inf = influence(sd);
    inf = inf * mask_cover(base, p, pl);
    if (inf <= 0.0) { continue; }
    let h = rec(base, 21u) + smp.x * rec(base, 3u); // elevation + extrude
    let op = u32(rec(base, 1u));
    // the FIRST shape (a non-carve "max" shape) to cover a pixel SETS the surface, so it can go below
    // the ground plane — negative Z is allowed. Later overlapping shapes, and carve shapes (which
    // subtract from the ground), always combine.
    let combined = select(combine_height(op, bigH, h), h, !covered && op != 1u);
    // mask = footprint COVERAGE (AA edge + trim masks), not height change — so a flat region (z=0, or
    // the low end of a slope) still writes its normal instead of vanishing (see evalCpu.ts).
    bigM = max(bigM, inf);
    // height is a HARD step at the footprint boundary so a vertical wall stays a wall — otherwise
    // the 1px influence ramp reads as a slope at the silhouette and minmod can't flatten it.
    bigH = select(bigH, combined, sd < 0.0);
    covered = covered || (sd < 0.0);
  }
  return vec2f(bigH, bigM);
}
`;

function dispatchSwitch(): string {
  const cases = allShapeTypes()
    .filter((t) => t.wgsl)
    .map((t, i) => {
      const fn = `shape_${t.id.replace(/-/g, "_")}`;
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

/** Shared field-eval library (buffers + shape fns + fold_at), included by fold + composite. */
export function buildFieldLibWgsl(): string {
  const shapeFns = allShapeTypes()
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
  const idx = allShapeTypes()
    .filter((t) => t.wgsl)
    .findIndex((t) => t.id === typeId);
  if (idx < 0) throw new Error(`shape type ${typeId} has no wgsl registration`);
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
