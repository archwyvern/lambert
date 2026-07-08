import { buildFieldLibWgsl } from "./wgsl";

/**
 * Screen composite for the 2D editor: a single analytic fragment pass. Each fragment maps screen px
 * -> doc coordinate via the viewport, then evaluates the field directly (fold_at) — no pre-rendered
 * field/normal textures. The normal is a minmod of fold_at's one-sided slopes (so vertical walls
 * vanish like a 3D bake instead of smearing to a 1px ramp); the coord snaps to the doc pixel and the
 * step is 1 doc px, so the preview always matches the pixelated, exported result. Mode 0 diffuse, 1
 * normal, 2 lit. The normal overlay blends over the diffuse by mask*opacity — previewing the NX alpha
 * masking exactly.
 *
 * PARITY NOTE (accepted): this preview derives its normal at DOC resolution (1-doc-px minmod step),
 * whereas the NX EXPORT renders at supersample=2 and downsamples (see gpu/pipeline.ts). So along a
 * slope the exported normal is a slightly smoother 2×-averaged version of what's shown here — the two
 * agree on flats, walls, and mask coverage, but not bit-for-bit on anti-aliased slope edges. This is
 * deliberate: sampling the preview at ss2 would cost ~4× the per-fragment fold work for a difference
 * only visible under magnification. If exact WYSIWYG on slopes ever matters, preview at ss2 here.
 */
const COMPOSITE_IO = /* wgsl */ `
struct PointLight {
  posX: f32,          // doc coords
  posY: f32,
  height: f32,        // doc units above the plane (the light's z)
  intensity: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  on: f32,            // 1 = contributes, 0 = skipped
}

struct CompositeUniforms {
  zoom: f32,
  panX: f32,
  panY: f32,
  mode: u32,          // bits 0-2: 0 diffuse, 1 normal, 2 lit, 3 coverage; bit 3: normal-view alpha gate
  canvasW: f32,
  canvasH: f32,
  opacity: f32,       // overlay opacity for the normal mode (1 = pure overlay)
  shapeCount: u32,
  lightX: f32,
  lightY: f32,
  lightZ: f32,
  nXX: f32,           // normal-direction encode transform (channel signs + frame rotation):
  nXY: f32,           //   encodedX = nXX*nx + nXY*ny, encodedY = nYX*nx + nYY*ny
  nYX: f32,
  nYY: f32,
  lightEnergy: f32,   // lit mode: scales the diffuse light term (1 = default; >1 brightens)
  lights: array<PointLight, 2>,  // lit-preview point lights (doc-space), summed on top of the directional
}

@group(0) @binding(0) var<uniform> cu: CompositeUniforms;
@group(0) @binding(5) var diffuseTex: texture_2d<f32>;
`;

const COMPOSITE_MAIN = /* wgsl */ `
// minmod of the two one-sided slopes (see normals.ts) — a vertical wall reads as flat instead of a
// 1px ramp, so the preview matches the exported bake. Real slopes pass through unchanged.
fn minmod(a: f32, b: f32) -> f32 {
  if (a * b <= 0.0) { return 0.0; }
  return select(b, a, abs(a) < abs(b));
}

// smoothness-guided one-sided gradient — the WGSL twin of sideGrad() in normals.ts (see there for
// the full rationale). Second differences detect a discontinuity per side; the clearly smoother
// side's slope wins, minmod is the tie fallback. Must match the CPU exactly.
const SMOOTH_EPS = 1e-4;
const DOM_LO = 0.333333333;
const DOM_HI = 0.6;
const STEP_LO = 0.25;
const STEP_HI = 1.0;
fn side_grad(hm2: f32, hm1: f32, h0: f32, hp1: f32, hp2: f32) -> f32 {
  let fwd = hp1 - h0;
  let bwd = h0 - hm1;
  let sf = max(abs(hp2 - 2.0 * hp1 + h0), SMOOTH_EPS);
  let sb = max(abs(h0 - 2.0 * hm1 + hm2), SMOOTH_EPS);
  let d = (sb - sf) / (sb + sf); // >0: forward side smoother
  let dom = clamp((abs(d) - DOM_LO) / (DOM_HI - DOM_LO), 0.0, 1.0);
  let gate = clamp((max(sf, sb) - STEP_LO) / (STEP_HI - STEP_LO), 0.0, 1.0); // real steps only
  let side = select(bwd, fwd, d > 0.0);
  let base = minmod(fwd, bwd);
  return mix(base, side, dom * gate); // CONTINUOUS blend — hard selects break f32/f64 parity
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
  let mode = cu.mode & 7u;
  let diffuse = textureLoad(diffuseTex, vec2i(p), 0);
  // composite over white using the diffuse's straight (un-premultiplied) alpha.
  let base = mix(vec3f(1.0, 1.0, 1.0), diffuse.rgb, diffuse.a);
  if (mode == 0u) { return vec4f(base, 1.0); }
  // Always the exported (raster) look: snap to the doc pixel centre + gradient at 1 doc px, so the
  // preview matches the pixelated NX bake exactly — there is no crisp "vector" mode that could mislead.
  let pe = floor(p) + vec2f(0.5, 0.5);
  let e = 1.0;
  let center = fold_at(pe, cu.shapeCount);
  let mask = center.y;
  let hc = center.x;
  // smoothness-guided gradient (matches the fold normal pass + CPU deriveNormals): a stencil side
  // that crosses a discontinuity (silhouette, mask carve, plate seam) is dropped, so sloped
  // surfaces keep their true normal right up to any edge — no fringe, no seam.
  let hxp = fold_at(pe + vec2f(e, 0.0), cu.shapeCount).x;  let hxp2 = fold_at(pe + vec2f(2.0 * e, 0.0), cu.shapeCount).x;
  let hxm = fold_at(pe - vec2f(e, 0.0), cu.shapeCount).x;  let hxm2 = fold_at(pe - vec2f(2.0 * e, 0.0), cu.shapeCount).x;
  let hyp = fold_at(pe + vec2f(0.0, e), cu.shapeCount).x;  let hyp2 = fold_at(pe + vec2f(0.0, 2.0 * e), cu.shapeCount).x;
  let hym = fold_at(pe - vec2f(0.0, e), cu.shapeCount).x;  let hym2 = fold_at(pe - vec2f(0.0, 2.0 * e), cu.shapeCount).x;
  let dHdx = side_grad(hxm2, hxm, hc, hxp, hxp2) / e;
  let dHdy = side_grad(hym2, hym, hc, hyp, hyp2) / e;
  let inv = inverseSqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
  let n = vec3f(-dHdx * inv, -dHdy * inv, inv);
  if (mode == 3u) {
    // coverage audit: solid red wherever the diffuse is OPAQUE but the authored mask is 0 —
    // "what haven't I covered yet". Covered/transparent pixels show the plain diffuse for context.
    let uncovered = diffuse.a > 0.0 && mask <= 0.0;
    return select(vec4f(base, 1.0), vec4f(0.85, 0.11, 0.11, 1.0), uncovered);
  }
  if (mode == 1u) {
    // normal view: the height-derived NX encoded over the sprite. The alpha gate (mode bit 3,
    // on by default) hides the encode where the diffuse is fully transparent — matching the
    // export, whose NX alpha is cleared wherever the diffuse has no pixel (see exporters/nx.ts).
    let gated = (cu.mode & 8u) != 0u && diffuse.a <= 0.0;
    let enc = vec3f(
      0.5 + (cu.nXX * n.x + cu.nXY * n.y) * 0.5,
      0.5 + (cu.nYX * n.x + cu.nYY * n.y) * 0.5,
      0.5 + n.z * 0.5,
    );
    return vec4f(mix(base, enc, mask * cu.opacity * select(1.0, 0.0, gated)), 1.0);
  }
  // lit: light only the diffuse itself, gated by its alpha. Transparent pixels (alpha 0) show the dark
  // viewport background (matching outside-the-doc) instead of a white box, and are never touched by the
  // light, no matter what object/normal sits under them — in 2D the only thing that gets lit is the
  // visible artwork.
  let l = normalize(vec3f(cu.lightX, cu.lightY, cu.lightZ));
  // ambient + the directional key light (white), then add each enabled point light (coloured, with a
  // height-scaled distance falloff). Point lights are positioned in doc space — their handles live in the
  // lit preview; pe is the doc-pixel centre, so the light vector is purely in doc units.
  var light = vec3f(0.25 + 0.75 * cu.lightEnergy * max(dot(n, l), 0.0));
  for (var i = 0u; i < 2u; i = i + 1u) {
    let pl = cu.lights[i];
    if (pl.on < 0.5) { continue; }
    let dxy = vec2f(pl.posX - pe.x, pl.posY - pe.y);
    let lp = normalize(vec3f(dxy, pl.height));
    let atten = pl.height * pl.height / (dot(dxy, dxy) + pl.height * pl.height);
    light += vec3f(pl.colorR, pl.colorG, pl.colorB) * pl.intensity * max(dot(n, lp), 0.0) * atten;
  }
  return vec4f(mix(vec3f(0.024, 0.024, 0.047), diffuse.rgb * light, diffuse.a), 1.0);
}
`;

/** Assemble the 2D composite module: composite IO + the shared field library + the fragment. */
export function buildCompositeWgsl(): string {
  return COMPOSITE_IO + buildFieldLibWgsl() + COMPOSITE_MAIN;
}
