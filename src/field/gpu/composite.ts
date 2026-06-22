import { buildFieldLibWgsl } from "./wgsl";

/**
 * Screen composite for the 2D editor: a single analytic fragment pass. Each fragment maps screen px
 * -> doc coordinate via the viewport, then evaluates the field directly (fold_at) — no pre-rendered
 * field/normal textures. The normal is a minmod of fold_at's one-sided slopes (so vertical walls
 * vanish like a 3D bake instead of smearing to a 1px ramp); in vector mode the step is ~1 display px
 * (crisp at any zoom), in raster mode the coord snaps to the doc pixel and the step is 1 doc px (the
 * pixelated, exported result). Mode 0 diffuse, 1 normal, 2 lit. The normal overlay
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
  full: u32,          // lit mode only: 1 = light the full Skyrat pipeline normals (skyratTex) instead
  lightEnergy: f32,   // lit mode: scales the diffuse light term (1 = default; >1 brightens)
}

@group(0) @binding(0) var<uniform> cu: CompositeUniforms;
@group(0) @binding(5) var diffuseTex: texture_2d<f32>;
// Full-pipeline preview: the CPU Skyrat generator's normals at doc res (x,y,z in [-1,1], w unused).
// Sampled per doc pixel in the lit branch when cu.full == 1.
@group(0) @binding(8) var skyratTex: texture_2d<f32>;
`;

const COMPOSITE_MAIN = /* wgsl */ `
// minmod of the two one-sided slopes (see normals.ts) — a vertical wall reads as flat instead of a
// 1px ramp, so the preview matches the exported bake. Real slopes pass through unchanged.
fn minmod(a: f32, b: f32) -> f32 {
  if (a * b <= 0.0) { return 0.0; }
  return select(b, a, abs(a) < abs(b));
}

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
  // composite over white using the diffuse's straight (un-premultiplied) alpha.
  let base = mix(vec3f(1.0, 1.0, 1.0), diffuse.rgb, diffuse.a);
  if (cu.mode == 0u) { return vec4f(base, 1.0); }
  // raster: snap to doc pixel center + diff at 1 doc px (the exported sobel). vector: exact coord +
  // diff at ~1 display px (-> the analytic gradient as you zoom in).
  let snap = cu.raster == 1u;
  let pe = select(p, floor(p) + vec2f(0.5, 0.5), snap);
  let e = select(1.0 / cu.zoom, 1.0, snap);
  let center = fold_at(pe, cu.shapeCount);
  let mask = center.y;
  let hc = center.x;
  let dHdx = minmod(fold_at(pe + vec2f(e, 0.0), cu.shapeCount).x - hc, hc - fold_at(pe - vec2f(e, 0.0), cu.shapeCount).x) / e;
  let dHdy = minmod(fold_at(pe + vec2f(0.0, e), cu.shapeCount).x - hc, hc - fold_at(pe - vec2f(0.0, e), cu.shapeCount).x) / e;
  let inv = inverseSqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
  var n = vec3f(-dHdx * inv, -dHdy * inv, inv);
  // full-pipeline preview: the baked Skyrat normal at this doc px (transparent px (0,0,0) -> flat, no NaN)
  let s = textureLoad(skyratTex, vec2i(p), 0).xyz;
  let sl = length(s);
  let skyN = select(vec3f(0.0, 0.0, 1.0), s / sl, sl > 1e-6);
  if (cu.mode == 1u) {
    // normal view: the height-derived NX, or — when full — the whole pipeline's normals over the sprite
    if (cu.full == 1u) {
      let encF = vec3f(0.5 + skyN.x * cu.redSign * 0.5, 0.5 + skyN.y * cu.greenSign * 0.5, 0.5 + skyN.z * 0.5);
      return vec4f(mix(base, encF, diffuse.a * cu.opacity), 1.0); // gate by sprite opacity, not the authored mask
    }
    let enc = vec3f(0.5 + n.x * cu.redSign * 0.5, 0.5 + n.y * cu.greenSign * 0.5, 0.5 + n.z * 0.5);
    return vec4f(mix(base, enc, mask * cu.opacity), 1.0);
  }
  // lit: light only the diffuse itself, gated by its alpha. Transparent pixels (alpha 0) keep the white
  // backdrop and are never touched by the light, no matter what shape/normal sits under them — in 2D the
  // only thing that gets lit is the visible artwork.
  if (cu.full == 1u) {
    n = skyN;
  }
  let l = normalize(vec3f(cu.lightX, cu.lightY, cu.lightZ));
  let lambert = max(dot(n, l), 0.0);
  let shade = 0.25 + 0.75 * cu.lightEnergy * lambert;
  return vec4f(mix(vec3f(1.0, 1.0, 1.0), diffuse.rgb * shade, diffuse.a), 1.0);
}
`;

/** Assemble the 2D composite module: composite IO + the shared field library + the fragment. */
export function buildCompositeWgsl(): string {
  return COMPOSITE_IO + buildFieldLibWgsl() + COMPOSITE_MAIN;
}
