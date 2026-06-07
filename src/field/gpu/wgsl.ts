import { allShapeTypes } from "../registry";

export const RECORD_F32 = 24;
export const PARAMS_OFFSET = 13;
export const MAX_PARAMS = 8;

/** Record layout (f32 slots): see pack.ts — typeIndex, op, (free), scaleZ, posXY,
 *  cos/sin(-rot), invScaleXY, distScale, cpStart, cpCount, params[8], elevation, pad[2]. */
const COMMON = /* wgsl */ `
struct Uniforms {
  width: u32,
  height: u32,
  shapeCount: u32,
  originX: f32,
  originY: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> records: array<f32>;
@group(0) @binding(2) var<storage, read> points: array<vec2f>;
@group(0) @binding(3) var outField: texture_storage_2d<rg32float, write>;

const RECORD: u32 = ${RECORD_F32}u;

fn rec(base: u32, i: u32) -> f32 { return records[base + i]; }

fn to_local(base: u32, p: vec2f) -> vec2f {
  let d = p - vec2f(rec(base, 4u), rec(base, 5u));
  let c = rec(base, 6u);
  let s = rec(base, 7u);
  let r = vec2f(d.x * c - d.y * s, d.x * s + d.y * c);
  return r * vec2f(rec(base, 8u), rec(base, 9u));
}

fn combine_height(op: u32, bigH: f32, h: f32) -> f32 {
  if (op == 1u) { return min(bigH, bigH - h); } // carve
  return max(bigH, h); // max (clip)
}

fn influence(sd: f32) -> f32 {
  if (sd <= 0.0) { return 1.0; }
  let t = clamp(1.0 - sd, 0.0, 1.0);
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

fn sd_ellipse(p: vec2f, r: vec2f) -> f32 {
  if (r.x == r.y) { return length(p) - r.x; }
  let k1 = length(p / r);
  let k2 = length(p / (r * r));
  return k1 * (k1 - 1.0) / max(k2, 1e-12);
}

fn shape_spine(p: vec2f, base: u32, h: f32, halfW: f32, prof: u32) -> vec2f {
  let cs = u32(rec(base, 11u));
  let cc = u32(rec(base, 12u));
  var d = 1e30;
  for (var i = 0u; i + 1u < cc; i = i + 1u) {
    d = min(d, sd_segment(p, points[cs + i], points[cs + i + 1u]));
  }
  let sd = d - halfW;
  return vec2f(h * apply_profile(prof, -sd, halfW), sd);
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
  let p = vec2f(f32(gid.x) + 0.5 + u.originX, f32(gid.y) + 0.5 + u.originY);
  var bigH = 0.0;
  var bigM = 0.0;
  for (var s = 0u; s < u.shapeCount; s = s + 1u) {
    let base = s * RECORD;
    let smp = eval_shape(u32(rec(base, 0u)), to_local(base, p), base);
    let inf = influence(smp.y * rec(base, 10u));
    if (inf <= 0.0) { continue; }
    let h = rec(base, 21u) + smp.x * rec(base, 3u); // elevation + extrude
    let next = mix(bigH, combine_height(u32(rec(base, 1u)), bigH, h), inf);
    // mask only where the shape actually changed the surface (sunk shapes leave none)
    bigM = max(bigM, min(1.0, abs(next - bigH) * 2.0));
    bigH = next;
  }
  textureStore(outField, vec2u(gid.xy), vec4f(bigH, bigM, 0.0, 0.0));
}
`;

/** Assemble the fold compute module from the registry. Deterministic given import order. */
export function buildFoldWgsl(): string {
  const shapeFns = allShapeTypes()
    .filter((t) => t.wgsl)
    .map((t) => t.wgsl!)
    .join("\n");
  return COMMON + shapeFns + dispatchSwitch() + FOLD_MAIN;
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

@compute @workgroup_size(8, 8)
fn normals(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= nu.width || gid.y >= nu.height) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let dx = (height_at(x + 1, y) - height_at(x - 1, y)) * 0.5 * nu.slopeScale;
  let dy = (height_at(x, y + 1) - height_at(x, y - 1)) * 0.5 * nu.slopeScale;
  let inv = inverseSqrt(dx * dx + dy * dy + 1.0);
  let m = textureLoad(fieldTex, vec2i(x, y), 0).g;
  textureStore(outNormal, vec2u(gid.xy), vec4f(-dx * inv, -dy * inv, inv, m));
}
`;

export function buildNormalWgsl(): string {
  return NORMAL_WGSL;
}
