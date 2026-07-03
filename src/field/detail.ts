import { decode } from "fast-png";
import { clamp } from "./vec";

/**
 * The Emboss/Detail precompute — an EXACT port of the skyrat Gradient stage
 * (services/skyrat-processing/internal/normalmap: Prepare grayscale, tolerance-gated Sobel,
 * opaque-masked gaussian smoothing), integrated into HEIGHT via Frankot–Chellappa so the fold's
 * normal derivation reproduces skyrat's gradient add. Chain, in order:
 *
 *   1. grayscale = (0.299·r + 0.587·g + 0.114·b) · a — the C# reference's Rec.601 luma, SCALED
 *      BY ALPHA: transparency reads as DARK, so silhouette rims and semi-transparent interior
 *      detail emboss like any other luminance edge. (The Go port's b·a formula is a port bug —
 *      the C# reference is the ground truth here.)
 *   2. tolerance-gated Sobel at ±radius offsets: neighbours within `tolerance` of the centre (or
 *      out of bounds) count AS the centre — the skyrat denoise. Transparent neighbours read as
 *      luminance 0 (dark), NOT as the centre. radius 1 = the reference stencil; larger samples
 *      further out for broader features.
 *   3. opaque-masked smoothing of the gradient field, sigma = `blur` (skyrat fixes 1). Small
 *      sigmas use skyrat's exact renormalized gaussian; past BOX_BLUR_SIGMA it switches to a
 *      3-pass box normalized convolution — O(pixels) regardless of sigma, so the blur slider
 *      can't melt large images.
 *   4. Frankot–Chellappa: the least-squares height whose gradient matches the field (FFT Poisson
 *      over a mirror-extended domain, so there are no wrap seams). Unnormalized, exactly like
 *      skyrat's unnormalized Sobel — the adjustment's `strength` (default 0.25, skyrat's
 *      detailStrength) then scales it in the fold, where the height derivation turns it back into
 *      the same normal tilt skyrat's neutralized add produces on flat ground.
 *
 * The chain runs off the frame path — once per (diffuse, radius, blur, tolerance); `strength`
 * is a fold constant, so scrubbing it never recomputes. Frame cost stays one bilinear sample.
 * In the editor the chain runs in a Web Worker with a progressive low-res pass
 * (ui/detailManager.ts) — `outScale` computes the whole chain on a downsampled grayscale, and the
 * resulting field carries its own `scale` so every sampler keeps working untouched.
 */

export interface DetailField {
  /** w*h*4 floats; the integrated detail height rides in .x (the other lanes are reserved). */
  data: Float32Array;
  width: number;
  height: number;
  /** Field texels per DOC pixel — 1 for a full-res field, <1 for a progressive preview. */
  scale: number;
}

/** The chain parameters (everything except strength, which lives in the fold). */
export interface DetailParams {
  radius: number;
  blur: number;
  tolerance: number;
}

export const DETAIL_DEFAULTS: DetailParams = { radius: 1, blur: 1, tolerance: 0.3 };

/** Above this sigma the masked blur switches from skyrat's exact gaussian (O(sigma) per pixel) to
 *  the 3-box normalized convolution (O(1) per pixel). 2 keeps the skyrat default (1) exact. */
export const BOX_BLUR_SIGMA = 2;

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
 * which makes the implied height an even reflection — periodic with NO wrap seams. Both real
 * gradient fields ride ONE forward transform as (gx + i·gy); the spectra split back out through
 * conjugate symmetry, so the whole solve is 2 FFTs instead of 3.
 */
function integrateGradient(dhdx: Float32Array, dhdy: Float32Array, w: number, h: number): Float32Array {
  const W = pow2(2 * w);
  const H = pow2(2 * h);
  const fRe = new Float64Array(W * H);
  const fIm = new Float64Array(W * H);
  for (let y = 0; y < 2 * h; y++) {
    const sy = y < h ? y : 2 * h - 1 - y; // source row
    const fy = y < h ? 1 : -1; // dhdy parity in y
    for (let x = 0; x < 2 * w; x++) {
      const sx = x < w ? x : 2 * w - 1 - x;
      const fx = x < w ? 1 : -1; // dhdx parity in x
      const i = y * W + x;
      fRe[i] = dhdx[sy * w + sx]! * fx;
      fIm[i] = dhdy[sy * w + sx]! * fy;
    }
  }
  fft2(fRe, fIm, W, H, false);
  const hRe = new Float64Array(W * H);
  const hIm = new Float64Array(W * H);
  for (let v = 0; v < H; v++) {
    // LINEAR frequency operators (2·pi·k/N), NOT the sin form: sin vanishes near Nyquist, so the
    // division amplified near-Nyquist noise into a +-checkerboard ring across the whole field.
    // The Sobel can't observe those frequencies anyway — the linear operator suppresses them.
    const wy = (2 * Math.PI * (v < H / 2 ? v : v - H)) / H;
    const vn = v === 0 ? 0 : H - v; // -k row
    for (let u = 0; u < W; u++) {
      const wx = (2 * Math.PI * (u < W / 2 ? u : u - W)) / W;
      const denom = wx * wx + wy * wy;
      if (denom < 1e-12) continue; // DC: height mean is arbitrary, leave 0
      const i = v * W + u;
      const j = vn * W + (u === 0 ? 0 : W - u); // F(-k)
      // unpack the packed spectra: Gx = (F(k)+conj(F(-k)))/2, Gy = (F(k)-conj(F(-k)))/(2i)
      const gxRe = (fRe[i]! + fRe[j]!) / 2;
      const gxIm = (fIm[i]! - fIm[j]!) / 2;
      const gyRe = (fIm[i]! + fIm[j]!) / 2;
      const gyIm = (fRe[j]! - fRe[i]!) / 2;
      // Ĥ = (−j·wx·Ĝx − j·wy·Ĝy) / (wx² + wy²)
      hRe[i] = (wx * gxIm + wy * gyIm) / denom;
      hIm[i] = -(wx * gxRe + wy * gyRe) / denom;
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
function maskedGaussianExact(src: Float32Array, opaque: Uint8Array, w: number, h: number, sigma: number): Float32Array {
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

/** The 3 box radii whose composite best approximates a gaussian of `sigma` (the W3C/StackBlur
 *  "boxes for gauss" construction). */
function boxRadiiForGauss(sigma: number): [number, number, number] {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const size = (i: number): number => (i < m ? wl : wu);
  return [(size(0) - 1) / 2, (size(1) - 1) / 2, (size(2) - 1) / 2];
}

/** One sliding-window box-SUM pass along a row-major axis; out-of-range taps contribute 0 (they
 *  cancel in the num/den divide, which is what renormalizes over the opaque mask). */
function boxSumPass(src: Float64Array, dst: Float64Array, w: number, h: number, r: number, horizontal: boolean): void {
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const strideO = horizontal ? w : 1;
  const strideI = horizontal ? 1 : w;
  for (let o = 0; o < outer; o++) {
    const base = o * strideO;
    let acc = 0;
    for (let k = 0; k <= Math.min(r, inner - 1); k++) acc += src[base + k * strideI]!;
    for (let x = 0; x < inner; x++) {
      dst[base + x * strideI] = acc;
      const add = x + r + 1;
      if (add < inner) acc += src[base + add * strideI]!;
      const drop = x - r;
      if (drop >= 0) acc -= src[base + drop * strideI]!;
    }
  }
}

/** Masked blur via 3-pass box normalized convolution: blur(v·m)/blur(m) with identical box sums on
 *  both, so opaque-mask renormalization (and edge handling) falls out of the divide. O(pixels)
 *  regardless of sigma — the fast path for large blur values. */
function maskedGaussianBox(src: Float32Array, opaque: Uint8Array, w: number, h: number, sigma: number): Float32Array {
  const radii = boxRadiiForGauss(sigma);
  let num = new Float64Array(w * h);
  let den = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (opaque[i]) {
      num[i] = src[i]!;
      den[i] = 1;
    }
  }
  let numT = new Float64Array(w * h);
  let denT = new Float64Array(w * h);
  for (const r of radii) {
    boxSumPass(num, numT, w, h, r, true);
    boxSumPass(den, denT, w, h, r, true);
    boxSumPass(numT, num, w, h, r, false);
    boxSumPass(denT, den, w, h, r, false);
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!opaque[i]) continue;
    out[i] = den[i]! > 0 ? num[i]! / den[i]! : src[i]!;
  }
  return out;
}

function maskedGaussian(src: Float32Array, opaque: Uint8Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src;
  return sigma <= BOX_BLUR_SIGMA ? maskedGaussianExact(src, opaque, w, h, sigma) : maskedGaussianBox(src, opaque, w, h, sigma);
}

/** Compute the detail height field from decoded RGBA pixels with the given chain params.
 *  `outScale` < 1 runs the chain on a box-downsampled grayscale (radius/blur scaled to match) —
 *  the progressive-preview pass; the returned field carries `scale` so samplers stay untouched. */
export function computeDetailField(
  img: { data: ArrayLike<number>; width: number; height: number; channels?: number },
  params: DetailParams = DETAIL_DEFAULTS,
  outScale = 1,
): DetailField {
  const sw = img.width;
  const sh = img.height;
  const cn = img.channels ?? 4;
  let peak = 0;
  for (let i = 0; i < sw * sh * cn; i++) peak = Math.max(peak, Number(img.data[i]));
  const norm = peak > 255 ? 65535 : 255;

  // 1. opacity + grayscale: the C# reference's Rec.601 luma, scaled by alpha so transparency
  // reads as dark — a fully transparent pixel is luminance 0, a half-transparent white is mid-gray
  let gray = new Float32Array(sw * sh);
  let opaque = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const a = cn === 4 || cn === 2 ? Number(img.data[i * cn + (cn - 1)]) / norm : 1;
    if (a <= 0) continue; // gray stays 0: dark
    opaque[i] = 1;
    const r = Number(img.data[i * cn]) / norm;
    const g = cn >= 3 ? Number(img.data[i * cn + 1]) / norm : r;
    const b = cn >= 3 ? Number(img.data[i * cn + 2]) / norm : r;
    gray[i] = (r * 0.299 + g * 0.587 + b * 0.114) * a;
  }

  // preview pass: box-downsample gray + opacity, run the identical chain on the small grid
  let w = sw;
  let h = sh;
  if (outScale < 1) {
    w = Math.max(1, Math.round(sw * outScale));
    h = Math.max(1, Math.round(sh * outScale));
    const dGray = new Float32Array(w * h);
    const dOpaque = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor((y * sh) / h);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor((x * sw) / w);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
        let acc = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            if (!opaque[yy * sw + xx]) continue;
            acc += gray[yy * sw + xx]!;
            n++;
          }
        }
        if (n > 0) {
          dGray[y * w + x] = acc / n;
          dOpaque[y * w + x] = 1;
        }
      }
    }
    gray = dGray;
    opaque = dOpaque;
  }
  const fieldScale = w / sw;

  // 2. tolerance-gated Sobel at ±radius (skyrat computeGradient; radius 1 = exact)
  const r0 = Math.max(1, Math.round(params.radius * fieldScale));
  const tol = Math.max(0, params.tolerance);
  const dhdx = new Float32Array(w * h);
  const dhdy = new Float32Array(w * h);
  // out of bounds clamps to the centre; a transparent neighbour reads its gray of 0 (dark), so a
  // bright shape against transparency gets a real rim gradient instead of a gated-out edge
  const adj = (center: number, x: number, y: number): number => {
    if (x < 0 || x >= w || y < 0 || y >= h) return center;
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
  const sgx = maskedGaussian(dhdx, opaque, w, h, params.blur * fieldScale);
  const sgy = maskedGaussian(dhdy, opaque, w, h, params.blur * fieldScale);

  // 4. integrate to height (Frankot–Chellappa)
  const height = integrateGradient(sgx, sgy, w, h);

  // Re-base so the TRANSPARENT far-field sits at ~0, and store the smooth solution EVERYWHERE.
  // Clipping transparent texels to 0 (the old behaviour) put a 1px step-UP just outside the
  // silhouette (the continuation there is negative) — supersampled exports derived an
  // opposite-tilt fringe from that artificial valley. The smooth field has no step; the export's
  // diffuse-alpha gate keeps anything outside the silhouette from shipping.
  let outsideSum = 0;
  let outsideN = 0;
  for (let i = 0; i < w * h; i++) {
    if (!opaque[i]) {
      outsideSum += height[i]!;
      outsideN++;
    }
  }
  const shift = outsideN > 0 ? outsideSum / outsideN : 0;
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data[i * 4] = height[i]! - shift;
  return { data, width: w, height: h, scale: fieldScale };
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

/** The FULL-RES detail field for a PNG byte buffer + chain params (decode + compute, cached).
 *  Synchronous — the export/CLI path. The editor preview goes through ui/detailManager.ts. */
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
