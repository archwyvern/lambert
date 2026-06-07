/**
 * Minimal lit composite for the harness: fullscreen triangle, textureLoad the normal
 * texture 1:1 (canvas sized to the texture), lambert from a uniform light. The real
 * preview compositor (diffuse underlay, view modes, zoom) is plan-3 work.
 */
export const LIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var normalTex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> light: vec4f; // xyz = dir (image space, y-down), w unused

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  let n = textureLoad(normalTex, vec2i(fragPos.xy), 0);
  let l = normalize(light.xyz);
  let lambert = max(dot(n.xyz, l), 0.0);
  let shade = 0.25 + 0.75 * lambert;
  let color = mix(vec3f(0.13), vec3f(shade), n.w); // unauthored = dark flat
  return vec4f(color, 1.0);
}
`;
