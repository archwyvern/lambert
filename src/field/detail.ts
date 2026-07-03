import { decode } from "fast-png";
import { clamp } from "./vec";

/**
 * The Emboss/Detail precompute — an EXACT port of the skyrat Gradient stage
 * (services/skyrat-processing/internal/normalmap: Prepare grayscale, tolerance-gated Sobel,
 * opaque-masked gaussian smoothing), integrated into HEIGHT via Frankot–Chellappa so the fold's
 * normal derivation reproduces skyrat's gradient add. Chain, in order:
 *
 *   1. grayscale = r·0.2126 + g·0.7152 + b·a on opaque (A > 0) pixels — the skyrat formula
 *      verbatim, quirks included (blue weighted by alpha).
 *   2. tolerance-gated Sobel at ±radius offsets: neighbours within `tolerance` of the centre (or
 *      transparent / out of bounds) count AS the centre — the skyrat denoise. radius 1 = skyrat
 *      exact; larger samples further out for broader features.
 *   3. opaque-masked separable gaussian on the gradient field, sigma = `blur` (skyrat fixes 1).
 *   4. Frankot–Chellappa: the least-squares height whose gradient matches the field (FFT Poisson
 *      over a mirror-extended domain, so there are no wrap seams). Unnormalized, exactly like
 *      skyrat's unnormalized Sobel — the adjustment's `strength` (default 0.25, skyrat's
 *      detailStrength) then scales it in the fold, where the height derivation turns it back into
 *      the same normal tilt skyrat's neutralized add produces on flat ground.
 *
 * The chain runs off the frame path — once per (diffuse, radius, blur, tolerance); `strength`
 * is a fold constant, so scrubbing it never recomputes. Frame cost stays one bilinear sample.
 */

export interface DetailField {
  /** w*h*4 floats; the integrated detail height rides in .x (the other lanes are reserved). */
  data: Float32Array;
  width: number;
  height: number;
}

/** The chain parameters (everything except strength, which lives in the fold). */
export interface DetailParams {
  radius: number;
  blur: number;
  tolerance: number;
}

export const DETAIL_DEFAULTS: DetailParams = { radius: 1, blur: 1, tolerance: 0.3 };

/** In-place iterative radix-2 FFT over interleaved re/im pairs (n must be a power of two). */
function fft(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 1 : -1) * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i]! /= n;
      im[i]! /= n;
    }
  }
}

/** 2D FFT (rows then columns) over an N×M complex grid. */
function fft2(re: Float64Array, im: Float64Array, w: number, h: number, invert: boolean): void {
  const rowRe = new Float64Array(w);
  const rowIm = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    rowRe.set(re.subarray(y * w, y * w + w));
    rowIm.set(im.subarray(y * w, y * w + w));
    fft(rowRe, rowIm, invert);
    re.set(rowRe, y * w);
    im.set(rowIm, y * w);
  }
  const colRe = new Float64Array(h);
  const colIm = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      colRe[y] = re[y * w + x]!;
      colIm[y] = im[y * w + x]!;
    }
    fft(colRe, colIm, invert);
    for (let y = 0; y < h; y++) {
      re[y * w + x] = colRe[y]!;
      im[y * w + x] = colIm[y]!;
    }
  }
}

const pow2 = (n: number): number => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Frankot–Chellappa: the least-squares integrable height for a target gradient field. The field
 * mirror-extends to 2W×2H with derivative parity (dhdx odd in x / even in y, dhdy the transpose),
 * which makes the implied height an even reflection — periodic with NO wrap seams.
 */
function integrateGradient(dhdx: Float32Array, dhdy: Float32Array, w: number, h: number): Float32Array {
  const W = pow2(2 * w);
  const H = pow2(2 * h);
  const gxRe = new Float64Array(W * H);
  const gxIm = new Float64Array(W * H);
  const gyRe = new Float64Array(W * H);
  const gyIm = new Float64Array(W * H);
  for (let y = 0; y < 2 * h; y++) {
    const sy = y < h ? y : 2 * h - 1 - y; // source row
    const fy = y < h ? 1 : -1; // dhdy parity in y
    for (let x = 0; x < 2 * w; x++) {
      const sx = x < w ? x : 2 * w - 1 - x;
      const fx = x < w ? 1 : -1; // dhdx parity in x
      const i = y * W + x;
      gxRe[i] = dhdx[sy * w + sx]! * fx;
      gyRe[i] = dhdy[sy * w + sx]! * fy;
    }
  }
  fft2(gxRe, gxIm, W, H, false);
  fft2(gyRe, gyIm, W, H, false);
  const hRe = new Float64Array(W * H);
  const hIm = new Float64Array(W * H);
  for (let v = 0; v < H; v++) {
    // discrete frequency operators (sin form matches the finite-difference gradient best)
    const wy = Math.sin((2 * Math.PI * (v < H / 2 ? v : v - H)) / H);
    for (let u = 0; u < W; u++) {
      const wx = Math.sin((2 * Math.PI * (u < W / 2 ? u : u - W)) / W);
      const denom = wx * wx + wy * wy;
      const i = v * W + u;
      if (denom < 1e-12) continue; // DC: height mean is arbitrary, leave 0
      // Ĥ = (−j·wx·Ĝx − j·wy·Ĝy) / (wx² + wy²)
      hRe[i] = (-wx * gxIm[i]! - wy * gyIm[i]!) / -denom;
      hIm[i] = (wx * gxRe[i]! + wy * gyRe[i]!) / -denom;
    }
  }
  fft2(hRe, hIm, W, H, true);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = hRe[y * W + x]!;
  }
  return out;
}

/** Opaque-masked separable gaussian (skyrat separableGaussian: renormalize over opaque taps). */
function maskedGaussian(src: Float32Array, opaque: Uint8Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src;
  const radius = Math.ceil(3 * sigma);
  const kernel = new Float64Array(radius * 2 + 1);
  for (let i = -radius; i <= radius; i++) kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!opaque[i]) continue;
      let acc = 0;
      let wSum = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = x + k;
        if (nx < 0 || nx >= w || !opaque[y * w + nx]) continue;
        acc += src[y * w + nx]! * kernel[k + radius]!;
        wSum += kernel[k + radius]!;
      }
      tmp[i] = wSum > 0 ? acc / wSum : src[i]!;
    }
  }
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (!opaque[i]) continue;
      let acc = 0;
      let wSum = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = y + k;
        if (ny < 0 || ny >= h || !opaque[ny * w + x]) continue;
        acc += tmp[ny * w + x]! * kernel[k + radius]!;
        wSum += kernel[k + radius]!;
      }
      out[i] = wSum > 0 ? acc / wSum : tmp[i]!;
    }
  }
  return out;
}

/** Compute the detail height field from decoded RGBA pixels with the given chain params. */
export function computeDetailField(
  img: { data: ArrayLike<number>; width: number; height: number; channels?: number },
  params: DetailParams = DETAIL_DEFAULTS,
): DetailField {
  const w = img.width;
  const h = img.height;
  const cn = img.channels ?? 4;
  let peak = 0;
  for (let i = 0; i < w * h * cn; i++) peak = Math.max(peak, Number(img.data[i]));
  const scale = peak > 255 ? 65535 : 255;

  // 1. skyrat Prepare: opacity + grayscale (their formula verbatim: r·0.2126 + g·0.7152 + b·a)
  const gray = new Float32Array(w * h);
  const opaque = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = cn === 4 || cn === 2 ? Number(img.data[i * cn + (cn - 1)]) / scale : 1;
    if (a <= 0) continue;
    opaque[i] = 1;
    const r = Number(img.data[i * cn]) / scale;
    const g = cn >= 3 ? Number(img.data[i * cn + 1]) / scale : r;
    const b = cn >= 3 ? Number(img.data[i * cn + 2]) / scale : r;
    gray[i] = r * 0.2126 + g * 0.7152 + b * a;
  }

  // 2. tolerance-gated Sobel at ±radius (skyrat computeGradient; radius 1 = exact)
  const r0 = Math.max(1, Math.round(params.radius));
  const tol = Math.max(0, params.tolerance);
  const dhdx = new Float32Array(w * h);
  const dhdy = new Float32Array(w * h);
  const adj = (center: number, x: number, y: number): number => {
    if (x < 0 || x >= w || y < 0 || y >= h || !opaque[y * w + x]) return center;
    const v = gray[y * w + x]!;
    return Math.abs(center - v) < tol ? center : v;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!opaque[i]) continue;
      const c = gray[i]!;
      const tl = adj(c, x - r0, y - r0);
      const t = adj(c, x, y - r0);
      const tr = adj(c, x + r0, y - r0);
      const l = adj(c, x - r0, y);
      const r = adj(c, x + r0, y);
      const bl = adj(c, x - r0, y + r0);
      const b = adj(c, x, y + r0);
      const br = adj(c, x + r0, y + r0);
      // the height gradient to integrate: dH = +Sobel (skyrat's normal add is g = −Sobel, and the
      // fold derives n.xy = −dH — the two negations cancel, so bright = high, exactly like skyrat)
      dhdx[i] = tr + 2 * r + br - (tl + 2 * l + bl);
      dhdy[i] = bl + 2 * b + br - (tl + 2 * t + tr);
    }
  }

  // 3. skyrat smooths the GRADIENT field (fixed sigma 1 there; `blur` here), opaque-masked
  const sgx = maskedGaussian(dhdx, opaque, w, h, params.blur);
  const sgy = maskedGaussian(dhdy, opaque, w, h, params.blur);

  // 4. integrate to height (Frankot–Chellappa)
  const height = integrateGradient(sgx, sgy, w, h);

  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data[i * 4] = opaque[i] ? height[i]! : 0;
  return { data, width: w, height: h };
}

/** Bilinear sample at texel-space (x, y); edge-clamped. [0] is the detail height. */
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

/** A stable cache key for the chain params (strength excluded — it never recomputes). */
export function detailParamsKey(params: DetailParams): string {
  return `${Math.max(1, Math.round(params.radius))}:${params.blur}:${params.tolerance}`;
}

// Per-diffuse cache of computed fields, keyed by chain params (bytes identity → param key).
// Closing the tab releases the bytes and every cached field with them.
const cache = new WeakMap<Uint8Array, Map<string, DetailField>>();

/** The detail field for a PNG byte buffer + chain params (decode + compute, cached). */
export function detailFieldForDiffuse(bytes: Uint8Array, params: DetailParams = DETAIL_DEFAULTS): DetailField {
  let perParams = cache.get(bytes);
  if (!perParams) {
    perParams = new Map();
    cache.set(bytes, perParams);
  }
  const key = detailParamsKey(params);
  const hit = perParams.get(key);
  if (hit) return hit;
  const field = computeDetailField(decode(bytes), params);
  perParams.set(key, field);
  return field;
}
