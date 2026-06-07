/**
 * Screen composite: maps screen px -> canvas px via the viewport transform, then shows
 * the doc per view mode. Mode 0 diffuse, 1 height (normalized grayscale), 2 normal
 * (color encode), 3 lit (diffuse * lambert). Onion = diffuse mixed under height/normal.
 * All textures loaded at nearest canvas px (pixelated under zoom, intentional).
 */
export const COMPOSITE_WGSL = /* wgsl */ `
struct CompositeUniforms {
  zoom: f32,
  panX: f32,
  panY: f32,
  mode: u32,          // 0 diffuse, 1 height, 2 normal, 3 lit
  canvasW: f32,
  canvasH: f32,
  onion: f32,         // diffuse underlay opacity for height/normal modes
  heightMin: f32,
  heightMax: f32,
  lightX: f32,
  lightY: f32,
  lightZ: f32,
}

@group(0) @binding(0) var<uniform> cu: CompositeUniforms;
@group(0) @binding(1) var fieldTex: texture_2d<f32>;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var diffuseTex: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  let c = (fragPos.xy - vec2f(cu.panX, cu.panY)) / cu.zoom;
  if (c.x < 0.0 || c.y < 0.0 || c.x >= cu.canvasW || c.y >= cu.canvasH) {
    return vec4f(0.063, 0.063, 0.075, 1.0); // outside doc: editor background
  }
  let px = vec2i(c);
  let diffuse = textureLoad(diffuseTex, px, 0);
  if (cu.mode == 0u) { return vec4f(diffuse.rgb, 1.0); }
  if (cu.mode == 1u) {
    let h = textureLoad(fieldTex, px, 0).r;
    let g = clamp((h - cu.heightMin) / max(cu.heightMax - cu.heightMin, 1e-6), 0.0, 1.0);
    return vec4f(mix(vec3f(g), diffuse.rgb, cu.onion), 1.0);
  }
  let n = textureLoad(normalTex, px, 0);
  if (cu.mode == 2u) {
    let enc = vec3f(0.5 + n.x * 0.5, 0.5 + n.y * 0.5, 0.5 + n.z * 0.5);
    return vec4f(mix(enc, diffuse.rgb, cu.onion), 1.0);
  }
  // lit: flat normals where unauthored give uniform shade, so the diffuse stays readable
  let l = normalize(vec3f(cu.lightX, cu.lightY, cu.lightZ));
  let lambert = max(dot(n.xyz, l), 0.0);
  let shade = 0.25 + 0.75 * lambert;
  return vec4f(diffuse.rgb * shade, 1.0);
}
`;
