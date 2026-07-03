import { decode } from "fast-png";
import { clamp } from "./vec";

/**
 * The Emboss/Detail precompute (the skyrat "Gradient" sense: diffuse-luminance surface detail).
 *
 * KEY ARCHITECTURE: the whole chain below runs ONCE per diffuse into a doc-res multi-band field —
 * it is PARAMETER-FREE (fixed skyrat-informed chain: median denoise, σ1 pre-blur, tolerance
 * deadzone), so the "detail" adjustment's params (amount + fine/medium/large band weights) are
 * plain fold constants and never trigger a recompute. Frame cost is one bilinear sample.
 *
 * Bands are difference-of-gaussians (band-pass) of the denoised luminance, so flat/baked lighting
 * cancels and only surface detail at each scale survives:
 *   fine   = G(1)  − G(2.5)   (pixel-scale grain, rivets, scratches)
 *   medium = G(2.5) − G(6)    (panel seams, greebles)
 *   large  = G(6)  − G(14)    (broad forms)
 * Each band is normalized to [-1, 1] with a soft tolerance deadzone (skyrat NORMALMAP_DEFAULTS
 * tolerance 0.3, relative) suppressing sensor/compression noise. Height-space integration: the
 * adjustment ADDS weighted bands to H, and the fold's normal derivation picks the detail up as the
 * Sobel of that — the same structure as skyrat's tolerance-gated Sobel of grays, kept
 * height-consistent (the exporter derives normals FROM heights).
 */

export interface DetailField {
  /** w*h*4 floats: (fine, medium, large, 0) per texel, each in [-1, 1]. */
  data: Float32Array;
  width: number;
  height: number;
}

const TOLERANCE = 0.3; // relative deadzone (skyrat NORMALMAP_DEFAULTS)
const SIGMAS = [1, 2.5, 6, 14] as const; // pre-blur + the three band boundaries

/** Separable gaussian blur of a single-channel field (edge-clamped). */
function gaussian(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += src[y * w + clamp(x + k, 0, w - 1)]! * kernel[k + radius]!;
      }
      tmp[y * w + x] = acc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += tmp[clamp(y + k, 0, h - 1) * w + x]! * kernel[k + radius]!;
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** 3x3 median denoise (single channel, edge-clamped). */
function median3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const win = new Float32Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          win[n++] = src[clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)]!;
        }
      }
      out[y * w + x] = [...win].sort((a, b) => a - b)[4]!;
    }
  }
  return out;
}

/** Compute the multi-band detail field from decoded RGBA (or gray) pixels. */
export function computeDetailField(img: { data: ArrayLike<number>; width: number; height: number; channels?: number }): DetailField {
  const w = img.width;
  const h = img.height;
  const cn = img.channels ?? 4;
  const depthMax = 255; // fast-png decodes 8-bit as Uint8Array; 16-bit sources land as 16-bit ints
  let max = 0;
  for (let i = 0; i < w * h * cn; i++) max = Math.max(max, Number(img.data[i]));
  const scale = max > 255 ? 65535 : depthMax;
  // alpha-gated luminance in [0, 1]
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = Number(img.data[i * cn]) / scale;
    const g = cn >= 3 ? Number(img.data[i * cn + 1]) / scale : r;
    const b = cn >= 3 ? Number(img.data[i * cn + 2]) / scale : r;
    const a = cn === 4 || cn === 2 ? Number(img.data[i * cn + (cn - 1)]) / scale : 1;
    lum[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
  }
  const denoised = median3(lum, w, h);
  const blurred = SIGMAS.map((s) => gaussian(denoised, w, h, s));
  const data = new Float32Array(w * h * 4);
  for (let band = 0; band < 3; band++) {
    const a = blurred[band]!;
    const b = blurred[band + 1]!;
    let peak = 1e-6;
    for (let i = 0; i < w * h; i++) peak = Math.max(peak, Math.abs(a[i]! - b[i]!));
    for (let i = 0; i < w * h; i++) {
      const v = (a[i]! - b[i]!) / peak; // normalized band-pass, [-1, 1]
      // soft tolerance deadzone: fully suppressed below tol/2, full through above tol
      const t = clamp((Math.abs(v) - TOLERANCE / 2) / (TOLERANCE / 2), 0, 1);
      data[i * 4 + band] = v * t * t * (3 - 2 * t);
    }
  }
  return { data, width: w, height: h };
}

/** Bilinear sample of the three bands at texel-space (x, y); edge-clamped, [-1,1] each. */
export function sampleDetail(field: DetailField, x: number, y: number): [number, number, number] {
  const { data, width: w, height: h } = field;
  const fx = clamp(x - 0.5, 0, w - 1);
  const fy = clamp(y - 0.5, 0, h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let band = 0; band < 3; band++) {
    const v00 = data[(y0 * w + x0) * 4 + band]!;
    const v10 = data[(y0 * w + x1) * 4 + band]!;
    const v01 = data[(y1 * w + x0) * 4 + band]!;
    const v11 = data[(y1 * w + x1) * 4 + band]!;
    out[band] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  }
  return out;
}

// Per-diffuse cache: the chain is parameter-free, so one field per diffuse byte buffer, for the
// tab's lifetime (WeakMap: closing the tab releases the bytes and the field together).
const cache = new WeakMap<Uint8Array, DetailField>();

/** The detail field for a PNG byte buffer (decode + compute, cached on the buffer identity). */
export function detailFieldForDiffuse(bytes: Uint8Array): DetailField {
  const hit = cache.get(bytes);
  if (hit) return hit;
  const field = computeDetailField(decode(bytes));
  cache.set(bytes, field);
  return field;
}
