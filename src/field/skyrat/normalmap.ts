// Faithful TS port of skyrat-processing/internal/normalmap (Prepare + stages) and math.go. This is
// the EXACT Skyrat normal-map generator used to preview the full pipeline; do not "improve" the math
// — it must match the Go/C# reference. Stage order (from pipeline.go): Bevel, BevelSmooth, Override,
// Radial, Gradient. The Tilt (slopes) stage is intentionally omitted (obsolete).
//
// One deliberate deviation from the Go: no 90° rotation (that is engine-orientation only; the preview
// stays upright and the effect is identical, the operations being isotropic).

import { Point, QuadTree } from "./quadtree";

/** Manifest defaults (packages/types NORMALMAP_DEFAULTS). detailStrength inverts to neutralization. */
export const SKYRAT_DEFAULTS = {
  bevelCoverage: 0.8,
  bevelSmoothing: 0.5,
  detailThreshold: 0.3,
  detailStrength: 0.25, // Gradient neutralization = 1 - detailStrength = 0.75
  radial: true,
};

// ---- math (math.go) ---------------------------------------------------------

type Vec3 = [number, number, number];

function normalize3(x: number, y: number, z: number): Vec3 {
  const mag = Math.sqrt(x * x + y * y + z * z);
  if (mag < 1e-10) return [0, 0, 1];
  return [x / mag, y / mag, z / mag];
}

function normalize2(x: number, y: number): [number, number] {
  const mag = Math.sqrt(x * x + y * y);
  if (mag < 1e-10) return [0, 0];
  return [x / mag, y / mag];
}

/** Lerp a vector toward (0,0,1) by ratio, then normalize. */
function neutralize(x: number, y: number, z: number, ratio: number): Vec3 {
  const r = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  return normalize3(x * (1 - r), y * (1 - r), z * (1 - r) + r);
}

function reconstructZ(x: number, y: number): number {
  const t = 1 - x * x - y * y;
  return t <= 0 ? 0 : Math.sqrt(t);
}

function computeDepth(coverage: number, opaquePixels: number, W: number, H: number): number {
  const density = opaquePixels / (W * H);
  const a = 4.0;
  const b = -2.0 * (W + H);
  const c = coverage * density * W * H;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 0;
  const sqrtD = Math.sqrt(disc);
  const d1 = (-b + sqrtD) / (2 * a);
  const d2 = (-b - sqrtD) / (2 * a);
  const maxD = Math.min(W, H) / 2;
  let best = -1.0;
  for (const d of [d1, d2]) {
    if (d >= 0 && d <= maxD && (best < 0 || d < best)) best = d;
  }
  return best < 0 ? 0 : best;
}

function gaussianKernel(sigma: number): { k: Float64Array; radius: number } {
  const radius = Math.ceil(3 * sigma);
  const size = 2 * radius + 1;
  const k = new Float64Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const v = Math.exp((-0.5 * x * x) / (sigma * sigma));
    k[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i]! /= sum;
  return { k, radius };
}

/** Separable Gaussian on a normal field (3/px). Transparent pixels skipped; renormalize after Y. */
function separableGaussian(normals: Float32Array, opaque: Uint8Array, w: number, h: number, sigma: number): Float32Array {
  const { k: kernel, radius } = gaussianKernel(sigma);
  const tmp = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const i = rowOff + x;
      if (!opaque[i]) continue;
      let ax = 0, ay = 0, az = 0, wSum = 0;
      for (let ki = 0; ki < kernel.length; ki++) {
        const nx = x + ki - radius;
        if (nx < 0 || nx >= w || !opaque[rowOff + nx]) continue;
        const kv = kernel[ki]!;
        const j = (rowOff + nx) * 3;
        ax += normals[j]! * kv;
        ay += normals[j + 1]! * kv;
        az += normals[j + 2]! * kv;
        wSum += kv;
      }
      if (wSum > 0) {
        tmp[i * 3] = ax / wSum;
        tmp[i * 3 + 1] = ay / wSum;
        tmp[i * 3 + 2] = az / wSum;
      } else {
        tmp[i * 3] = normals[i * 3]!;
        tmp[i * 3 + 1] = normals[i * 3 + 1]!;
        tmp[i * 3 + 2] = normals[i * 3 + 2]!;
      }
    }
  }
  const out = new Float32Array(w * h * 3);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (!opaque[i]) continue;
      let ax = 0, ay = 0, az = 0, wSum = 0;
      for (let ki = 0; ki < kernel.length; ki++) {
        const ny = y + ki - radius;
        if (ny < 0 || ny >= h || !opaque[ny * w + x]) continue;
        const kv = kernel[ki]!;
        const j = (ny * w + x) * 3;
        ax += tmp[j]! * kv;
        ay += tmp[j + 1]! * kv;
        az += tmp[j + 2]! * kv;
        wSum += kv;
      }
      if (wSum > 0) {
        const n = normalize3(ax / wSum, ay / wSum, az / wSum);
        out[i * 3] = n[0];
        out[i * 3 + 1] = n[1];
        out[i * 3 + 2] = n[2];
      } else {
        out[i * 3] = tmp[i * 3]!;
        out[i * 3 + 1] = tmp[i * 3 + 1]!;
        out[i * 3 + 2] = tmp[i * 3 + 2]!;
      }
    }
  }
  return out;
}

/** 1-D squared-distance transform (Felzenszwalb parabolic envelope); f/d are length n. */
function dt1d(f: Float64Array, d: Float64Array, n: number): void {
  const INF = 1e18;
  let firstFinite = -1;
  for (let i = 0; i < n; i++) {
    if (f[i]! < INF) {
      firstFinite = i;
      break;
    }
  }
  if (firstFinite < 0) {
    for (let i = 0; i < n; i++) d[i] = INF;
    return;
  }
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = firstFinite;
  z[0] = -Infinity;
  z[1] = Infinity;
  const intersect = (q: number, i: number): number => (f[q]! + q * q - f[i]! - i * i) / (2 * (q - i));
  for (let q = firstFinite + 1; q < n; q++) {
    if (f[q]! >= INF) continue;
    let s = intersect(q, v[k]!);
    while (s <= z[k]!) {
      k--;
      s = intersect(q, v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dx = q - v[k]!;
    d[q] = dx * dx + f[v[k]!]!;
  }
}

/** Euclidean distance to the nearest transparent pixel, per pixel (separable EDT). */
function distanceTransform(opaque: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e18;
  const temp = new Float32Array(w * h);
  const colF = new Float64Array(h);
  const colD = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) colF[y] = opaque[y * w + x] ? INF : 0;
    dt1d(colF, colD, h);
    for (let y = 0; y < h; y++) temp[x + y * w] = colD[y]!;
  }
  const dist = new Float32Array(w * h);
  const rowF = new Float64Array(w);
  const rowD = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) rowF[x] = temp[off + x]!;
    dt1d(rowF, rowD, w);
    for (let x = 0; x < w; x++) dist[off + x] = Math.sqrt(rowD[x]!);
  }
  return dist;
}

/** The most-interior opaque pixel (EDT argmax, tie→smaller y then x) + its furthest opaque distance. */
function visualCenterAndFurthest(opaque: Uint8Array, w: number, h: number): { cx: number; cy: number; furthest: number } {
  const dist = distanceTransform(opaque, w, h);
  let maxDist = -1;
  let vcX = -1;
  let vcY = -1;
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      if (!opaque[rowOff + x]) continue;
      const d = dist[rowOff + x]!;
      if (d > maxDist) {
        // row-major scan with strict > yields smallest-y then smallest-x among the max (the Go tie-break)
        maxDist = d;
        vcX = x;
        vcY = y;
      }
    }
  }
  if (vcX < 0) return { cx: w / 2, cy: h / 2, furthest: 0 };
  const cx = vcX + 0.5;
  const cy = vcY + 0.5;
  let furthest = 0;
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    const fy = y + 0.5;
    for (let x = 0; x < w; x++) {
      if (!opaque[rowOff + x]) continue;
      const dx = x + 0.5 - cx;
      const dy = fy - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > furthest) furthest = d;
    }
  }
  return { cx, cy, furthest };
}

function computeGradient(
  x: number,
  y: number,
  gray: Float32Array,
  opaque: Uint8Array,
  w: number,
  h: number,
  tolerance: number,
  neutralization: number,
): Vec3 {
  const center = gray[y * w + x]!;
  const adj = (nx: number, ny: number): number => {
    if (nx < 0 || nx >= w || ny < 0 || ny >= h || !opaque[ny * w + nx]) return center;
    const v = gray[ny * w + nx]!;
    if (Math.abs(center - v) < tolerance) return center;
    return v;
  };
  const tl = adj(x - 1, y - 1);
  const t = adj(x, y - 1);
  const tr = adj(x + 1, y - 1);
  const l = adj(x - 1, y);
  const r = adj(x + 1, y);
  const bl = adj(x - 1, y + 1);
  const b = adj(x, y + 1);
  const br = adj(x + 1, y + 1);
  const ddx = tr + 2 * r + br - (tl + 2 * l + bl);
  const ddy = bl + 2 * b + br - (tl + 2 * t + tr);
  const gx = -ddx;
  const gy = -ddy;
  return neutralize(gx, gy, reconstructZ(gx, gy), neutralization);
}

// ---- Canvas + stages (normalmap.go, stages.go) ------------------------------

export class Canvas {
  readonly w: number;
  readonly h: number;
  readonly opaque: Uint8Array;
  readonly gray: Float32Array;
  normals: Float32Array; // 3 per px
  private edges: QuadTree;
  private depth: number;
  private vcx: number;
  private vcy: number;
  private furthest: number;

  private constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.opaque = new Uint8Array(n);
    this.gray = new Float32Array(n);
    this.normals = new Float32Array(n * 3);
    this.edges = new QuadTree([], -1, -1, w, h);
    this.depth = 0;
    this.vcx = 0;
    this.vcy = 0;
    this.furthest = 0;
  }

  /** First step: opacity, grayscale, edge points, quadtree, bevel depth, visual center.
   *  `data` is straight (un-premultiplied) RGBA8, row-major, 4 channels. */
  static prepare(data: Uint8Array | Uint8ClampedArray, w: number, h: number, coverage: number): Canvas {
    const c = new Canvas(w, h);
    let opaqueCount = 0;
    for (let i = 0, n = w * h; i < n; i++) {
      const a = data[i * 4 + 3]!;
      if (a > 0) {
        c.opaque[i] = 1;
        opaqueCount++;
        const r = data[i * 4]! / 255;
        const g = data[i * 4 + 1]! / 255;
        const b = data[i * 4 + 2]! / 255;
        c.gray[i] = r * 0.2126 + g * 0.7152 + (b * a) / 255; // exact Skyrat formula (blue * alpha)
      }
    }
    // edge points: every transparent/out-of-bounds 8-neighbour of an opaque pixel
    const dx8 = [-1, 0, 1, -1, 1, -1, 0, 1];
    const dy8 = [-1, -1, -1, 0, 0, 1, 1, 1];
    const edgePoints: Point[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!c.opaque[y * w + x]) continue;
        for (let d = 0; d < 8; d++) {
          const nx = x + dx8[d]!;
          const ny = y + dy8[d]!;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || !c.opaque[ny * w + nx]) edgePoints.push({ x: nx, y: ny });
        }
      }
    }
    c.edges = new QuadTree(edgePoints, -1, -1, w, h);
    c.depth = computeDepth(coverage, opaqueCount, w, h);
    const vc = visualCenterAndFurthest(c.opaque, w, h);
    c.vcx = vc.cx;
    c.vcy = vc.cy;
    c.furthest = vc.furthest;
    return c;
  }

  /** Bevel normals: each opaque pixel points toward its nearest edge, neutralized by length/depth. */
  bevel(): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (!this.opaque[i]) continue;
        const edge = this.edges.findNearest(x, y);
        const ox = edge.x - x;
        const oy = edge.y - y;
        const length = Math.sqrt(ox * ox + oy * oy);
        if (length < 1e-10 || this.depth <= 0) {
          this.setN(i, 0, 0, 1);
          continue;
        }
        const [nx, ny] = normalize2(ox, oy);
        const n = neutralize(nx, ny, 0, length / this.depth);
        this.setN(i, n[0], n[1], n[2]);
      }
    }
  }

  smooth(sigma: number): void {
    this.normals = separableGaussian(this.normals, this.opaque, this.w, this.h, sigma);
  }

  /** sigma = max(0.0001, depth * smoothFactor / 3), then smooth (matches the C# reference). */
  bevelSmooth(smoothFactor: number): void {
    this.smooth(Math.max(0.0001, (this.depth * smoothFactor) / 3.0));
  }

  /** Replace normals with the override's vectors wherever the override mask > 0 and the pixel is
   *  opaque. `nxNormals` are the already-decoded normals (the caller applies the project's channel
   *  signs so the round-trip matches Skyrat's ColorToNormal). */
  override(nxNormals: Float32Array, nxMask: Float32Array): void {
    for (let i = 0, n = this.w * this.h; i < n; i++) {
      if (!this.opaque[i] || nxMask[i]! <= 0) continue;
      this.setN(i, nxNormals[i * 3]!, nxNormals[i * 3 + 1]!, nxNormals[i * 3 + 2]!);
    }
  }

  /** Radial dome: tilt each pixel outward from the visual center, the whole vector added incl. Z. */
  radial(): void {
    if (this.furthest <= 0) return;
    const { w, h } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!this.opaque[i]) continue;
        let rx = x - this.vcx;
        let ry = y - this.vcy;
        if (w > h) ry *= w / h;
        else rx *= h / w;
        const dist = Math.sqrt(rx * rx + ry * ry);
        if (dist < 1e-10) continue;
        const [rnx, rny] = normalize2(rx, ry);
        const ratio = 1 - dist / this.furthest;
        const radN = neutralize(rnx, rny, 0, ratio);
        const n = normalize3(this.normals[i * 3]! + radN[0], this.normals[i * 3 + 1]! + radN[1], this.normals[i * 3 + 2]! + radN[2]);
        this.setN(i, n[0], n[1], n[2]);
      }
    }
  }

  /** Sobel surface-detail normals, neutralized, smoothed (σ=1), and added to the current normals. */
  gradient(tolerance: number, neutralization: number): void {
    const { w, h } = this;
    const grad = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!this.opaque[i]) continue;
        const g = computeGradient(x, y, this.gray, this.opaque, w, h, tolerance, neutralization);
        grad[i * 3] = g[0];
        grad[i * 3 + 1] = g[1];
        grad[i * 3 + 2] = g[2];
      }
    }
    const sg = separableGaussian(grad, this.opaque, w, h, 1.0);
    for (let i = 0, n = w * h; i < n; i++) {
      if (!this.opaque[i]) continue;
      const out = normalize3(this.normals[i * 3]! + sg[i * 3]!, this.normals[i * 3 + 1]! + sg[i * 3 + 1]!, this.normals[i * 3 + 2]! + sg[i * 3 + 2]!);
      this.setN(i, out[0], out[1], out[2]);
    }
  }

  private setN(i: number, x: number, y: number, z: number): void {
    this.normals[i * 3] = x;
    this.normals[i * 3 + 1] = y;
    this.normals[i * 3 + 2] = z;
  }
}

/**
 * Run the full default Skyrat pipeline for the in-app preview: bevel → bevel-smooth → NX override →
 * radial → gradient (slopes/tilt omitted). `nxNormals` are Lambert's canonical normals and `signs`
 * are the project's channel signs; they're decoded to Skyrat's space `(red·x, -green·y, z)` so the
 * override matches what Skyrat's reader would decode from the encoded .nx.png. Returns the per-pixel
 * normal field (3/px; transparent pixels stay (0,0,0)) plus the opacity mask.
 */
export function generateFull(
  diffuse: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  nxNormals: Float32Array,
  nxMask: Float32Array,
  signs: { red: number; green: number },
): { normals: Float32Array; opaque: Uint8Array } {
  const c = Canvas.prepare(diffuse, w, h, SKYRAT_DEFAULTS.bevelCoverage);
  c.bevel();
  c.bevelSmooth(SKYRAT_DEFAULTS.bevelSmoothing);
  // decode Lambert's NX into Skyrat's normal space (default red-right/green-up => identity)
  const decoded = new Float32Array(nxNormals.length);
  for (let i = 0, n = w * h; i < n; i++) {
    decoded[i * 3] = signs.red * nxNormals[i * 3]!;
    decoded[i * 3 + 1] = -signs.green * nxNormals[i * 3 + 1]!;
    decoded[i * 3 + 2] = nxNormals[i * 3 + 2]!;
  }
  c.override(decoded, nxMask);
  if (SKYRAT_DEFAULTS.radial) c.radial();
  c.gradient(SKYRAT_DEFAULTS.detailThreshold, 1 - SKYRAT_DEFAULTS.detailStrength);
  return { normals: c.normals, opaque: c.opaque };
}
