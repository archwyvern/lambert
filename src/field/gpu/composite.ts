import { buildFieldLibWgsl } from "./wgsl";

/**
 * Screen composite for the 2D editor: a single analytic fragment pass. Each fragment maps screen px
 * -> doc coordinate via the viewport, then evaluates the field directly (fold_at) — no pre-rendered
 * field/normal textures. The normal is a central difference of fold_at; in vector mode the step is
 * ~1 display px (crisp at any zoom), in raster mode the coord snaps to the doc pixel and the step is
 * 1 doc px (the pixelated, exported result). Mode 0 diffuse, 1 normal, 2 lit. The normal overlay
 * blends over the diffuse by mask*opacity — previewing the NX alpha masking exactly.
 */
const COMPOSITE_IO = /* wgsl */ `
struct CompositeUniforms {
  zoom: f32,
  panX: f32,
  panY: f32,
  mode: u32,          // 0 diffuse, 1 normal, 2 lit
  canvasW: f32,
  canvasH: f32,
  opacity: f32,       // overlay opacity for the normal mode (1 = pure overlay)
  shapeCount: u32,
  lightX: f32,
  lightY: f32,
  lightZ: f32,
  redSign: f32,       // project normal-direction signs for the normal view encode
  greenSign: f32,
  raster: u32,        // 1 = snap to doc pixels + 1-doc-px gradient (exported look); 0 = crisp vector
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> cu: CompositeUniforms;
@group(0) @binding(5) var diffuseTex: texture_2d<f32>;
`;

const COMPOSITE_MAIN = /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  let p = (fragPos.xy - vec2f(cu.panX, cu.panY)) / cu.zoom; // doc coordinate
  if (p.x < 0.0 || p.y < 0.0 || p.x >= cu.canvasW || p.y >= cu.canvasH) {
    return vec4f(0.024, 0.024, 0.047, 1.0); // outside doc: viewport background (#06060c)
  }
  let diffuse = textureLoad(diffuseTex, vec2i(p), 0);
  if (cu.mode == 0u) { return vec4f(diffuse.rgb, 1.0); }
  // raster: snap to doc pixel center + diff at 1 doc px (the exported sobel). vector: exact coord +
  // diff at ~1 display px (-> the analytic gradient as you zoom in).
  let snap = cu.raster == 1u;
  let pe = select(p, floor(p) + vec2f(0.5, 0.5), snap);
  let e = select(1.0 / cu.zoom, 1.0, snap);
  let mask = fold_at(pe, cu.shapeCount).y;
  let dHdx = (fold_at(pe + vec2f(e, 0.0), cu.shapeCount).x - fold_at(pe - vec2f(e, 0.0), cu.shapeCount).x) / (2.0 * e);
  let dHdy = (fold_at(pe + vec2f(0.0, e), cu.shapeCount).x - fold_at(pe - vec2f(0.0, e), cu.shapeCount).x) / (2.0 * e);
  let inv = inverseSqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
  let n = vec3f(-dHdx * inv, -dHdy * inv, inv);
  if (cu.mode == 1u) {
    let enc = vec3f(0.5 + n.x * cu.redSign * 0.5, 0.5 + n.y * cu.greenSign * 0.5, 0.5 + n.z * 0.5);
    return vec4f(mix(diffuse.rgb, enc, mask * cu.opacity), 1.0);
  }
  // lit: flat normals where unauthored give uniform shade, so the diffuse stays readable
  let l = normalize(vec3f(cu.lightX, cu.lightY, cu.lightZ));
  let lambert = max(dot(n, l), 0.0);
  let shade = 0.25 + 0.75 * lambert;
  return vec4f(diffuse.rgb * shade, 1.0);
}
`;

/** Assemble the 2D composite module: composite IO + the shared field library + the fragment. */
export function buildCompositeWgsl(): string {
  return COMPOSITE_IO + buildFieldLibWgsl() + COMPOSITE_MAIN;
}
