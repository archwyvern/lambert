/**
 * 3D inspection preview: a displaced grid over the height texture, lit with the SAME
 * image-space lambert as the 2D lit view (lighting cannot disagree between previews).
 * Read-only diagnostic — the lit view remains the in-game ground truth.
 */

export const PREVIEW3D_WGSL = /* wgsl */ `
struct U {
  mvp: mat4x4f,
  gridW: f32,
  gridH: f32,
  docW: f32,
  docH: f32,
  lightX: f32,
  lightY: f32,
  lightZ: f32,
  zScale: f32,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var fieldTex: texture_2d<f32>;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var diffuseTex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

fn height_at(px: vec2i) -> f32 {
  let c = clamp(px, vec2i(0), vec2i(i32(u.docW) - 1, i32(u.docH) - 1));
  return textureLoad(fieldTex, c, 0).r;
}

fn height_bilinear(p: vec2f) -> f32 {
  let f = p - vec2f(0.5);
  let i0 = vec2i(floor(f));
  let t = fract(f);
  let h00 = height_at(i0);
  let h10 = height_at(i0 + vec2i(1, 0));
  let h01 = height_at(i0 + vec2i(0, 1));
  let h11 = height_at(i0 + vec2i(1, 1));
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let quad = vi / 6u;
  let corner = vi % 6u;
  let qx = quad % u32(u.gridW);
  let qy = quad / u32(u.gridW);
  var off: vec2u;
  switch corner {
    case 0u: { off = vec2u(0u, 0u); }
    case 1u: { off = vec2u(1u, 0u); }
    case 2u: { off = vec2u(0u, 1u); }
    case 3u: { off = vec2u(1u, 0u); }
    case 4u: { off = vec2u(1u, 1u); }
    default: { off = vec2u(0u, 1u); }
  }
  let g = vec2f(f32(qx + off.x), f32(qy + off.y));
  let uv = g / vec2f(u.gridW, u.gridH);
  let pcanvas = uv * vec2f(u.docW, u.docH);
  let h = height_bilinear(pcanvas) * u.zScale;
  // world: x = canvas x (centered), y = height (up), z = canvas y (centered)
  let world = vec3f(pcanvas.x - u.docW * 0.5, h, pcanvas.y - u.docH * 0.5);
  var out: VOut;
  out.pos = u.mvp * vec4f(world, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let px = clamp(
    vec2i(in.uv * vec2f(u.docW, u.docH)),
    vec2i(0),
    vec2i(i32(u.docW) - 1, i32(u.docH) - 1),
  );
  // lambert entirely in image space: identical shading to the 2D lit composite
  let n = textureLoad(normalTex, px, 0).xyz;
  let albedo = textureLoad(diffuseTex, px, 0).rgb;
  let l = normalize(vec3f(u.lightX, u.lightY, u.lightZ));
  let shade = 0.25 + 0.75 * max(dot(n, l), 0.0);
  return vec4f(albedo * shade, 1.0);
}
`;

export const GRID = 256;

export interface Orbit {
  yaw: number;
  pitch: number;
  /** Distance as a multiple of the doc's larger dimension. */
  dist: number;
  /** Target offset in the camera's screen plane, as a fraction of the doc's larger dim. */
  panX: number;
  panY: number;
}

export const DEFAULT_ORBIT: Orbit = { yaw: 0.65, pitch: 0.65, dist: 1.3, panX: 0, panY: 0 };

// -- minimal column-major mat4 (WebGPU clip space, depth 0..1) --

export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

export function lookAt(eye: [number, number, number], center: [number, number, number]): Float32Array {
  const up: [number, number, number] = [0, 1, 0];
  const zx = eye[0] - center[0];
  const zy = eye[1] - center[1];
  const zz = eye[2] - center[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const x = [up[1] * z[2]! - up[2] * z[1]!, up[2] * z[0]! - up[0] * z[2]!, up[0] * z[1]! - up[1] * z[0]!];
  const xl = Math.hypot(x[0]!, x[1]!, x[2]!) || 1;
  x[0]! /= xl;
  x[1]! /= xl;
  x[2]! /= xl;
  const y = [z[1]! * x[2]! - z[2]! * x[1]!, z[2]! * x[0]! - z[0]! * x[2]!, z[0]! * x[1]! - z[1]! * x[0]!];
  const out = new Float32Array(16);
  out[0] = x[0]!;
  out[1] = y[0]!;
  out[2] = z[0]!;
  out[4] = x[1]!;
  out[5] = y[1]!;
  out[6] = z[1]!;
  out[8] = x[2]!;
  out[9] = y[2]!;
  out[10] = z[2]!;
  out[12] = -(x[0]! * eye[0] + x[1]! * eye[1] + x[2]! * eye[2]);
  out[13] = -(y[0]! * eye[0] + y[1]! * eye[1] + y[2]! * eye[2]);
  out[14] = -(z[0]! * eye[0] + z[1]! * eye[1] + z[2]! * eye[2]);
  out[15] = 1;
  return out;
}

export function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** MVP for an orbit camera; pan slides the look-at target in the camera's screen plane. */
export function orbitMvp(orbit: Orbit, docW: number, docH: number, aspect: number): Float32Array {
  const span = Math.max(docW, docH);
  const radius = span * orbit.dist;
  const off: [number, number, number] = [
    radius * Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
    radius * Math.sin(orbit.pitch),
    radius * Math.cos(orbit.pitch) * Math.cos(orbit.yaw),
  ];
  // camera basis from the view direction (target -> eye is +off): right & up span the screen
  const fl = Math.hypot(off[0], off[1], off[2]) || 1;
  const fwd: [number, number, number] = [-off[0] / fl, -off[1] / fl, -off[2] / fl];
  const right: [number, number, number] = [fwd[2], 0, -fwd[0]];
  const rl = Math.hypot(right[0], right[1], right[2]) || 1;
  right[0] /= rl;
  right[2] /= rl;
  const up: [number, number, number] = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const px = orbit.panX * span;
  const py = orbit.panY * span;
  const target: [number, number, number] = [right[0] * px + up[0] * py, right[1] * px + up[1] * py, right[2] * px + up[2] * py];
  const eye: [number, number, number] = [target[0] + off[0], target[1] + off[1], target[2] + off[2]];
  const proj = perspective(Math.PI / 4, aspect, 1, radius * 10 + span);
  return mat4Mul(proj, lookAt(eye, target));
}
