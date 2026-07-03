import type { DetailField } from "./detail";
import { evaluateField, FieldResult } from "./evalCpu";
import type { ResolvedObject } from "./flatten";
import { deriveNormals } from "./normals";
import { v2 } from "./vec";

export interface RenderResult {
  width: number;
  height: number;
  heightMap: Float32Array;
  mask: Float32Array;
  /** Packed xyz, unit length, image-space y-down. */
  normals: Float32Array;
}

export interface RenderOptions {
  /** Integer supersampling factor; 2 = spec export quality. */
  supersample: 1 | 2;
  /** The Emboss/Detail bands (doc-res), sampled by "detail" adjustments; absent = zeros. */
  detail?: DetailField | null;
}

/**
 * Scale resolved objects onto a canvas f times larger: the world point grows by f, so the inverse
 * affine's linear part divides by f (translation unchanged — `local = invAffine·(p_hi/f)`), and the
 * scale hint grows by f. Tallness/elevation (z) do NOT scale — the normal derivation compensates
 * with slopeScale = f. World (non-follow) masks are canvas coords and scale by f; follow masks live
 * in object-local space (scale-invariant — scaleHint carries f).
 */
export function scaleResolvedForSupersample(resolved: ResolvedObject[], f: number): ResolvedObject[] {
  return resolved.map((rs) => {
    const inv = rs.invAffine;
    return {
      ...rs,
      invAffine: { a: inv.a / f, b: inv.b / f, c: inv.c / f, d: inv.d / f, e: inv.e, f: inv.f },
      scaleHint: rs.scaleHint * f,
      masks: rs.masks.map((m) =>
        m.follow
          ? m
          : {
              ...m,
              anchors: m.anchors.map((a) => ({
                ...a,
                p: v2(a.p.x * f, a.p.y * f),
                hIn: v2(a.hIn.x * f, a.hIn.y * f),
                hOut: v2(a.hOut.x * f, a.hOut.y * f),
              })),
            },
      ),
    };
  });
}

/**
 * Box-filter a hi-res field + its normals down by factor f; normals renormalize.
 * Shared by the CPU reference and the GPU export path (which reads back hi-res tiles).
 */
export function downsampleRender(hi: FieldResult, hiNormals: Float32Array, f: number): RenderResult {
  const width = hi.width / f;
  const height = hi.height / f;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`hi-res dims ${hi.width}x${hi.height} not divisible by ${f}`);
  }
  const heightMap = new Float32Array(width * height);
  const mask = new Float32Array(width * height);
  const normals = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sh = 0;
      let sm = 0;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let sy = 0; sy < f; sy++) {
        for (let sx = 0; sx < f; sx++) {
          const i = (y * f + sy) * hi.width + (x * f + sx);
          sh += hi.heightMap[i]!;
          sm += hi.mask[i]!;
          nx += hiNormals[i * 3]!;
          ny += hiNormals[i * 3 + 1]!;
          nz += hiNormals[i * 3 + 2]!;
        }
      }
      const inv = 1 / (f * f);
      const o = y * width + x;
      heightMap[o] = sh * inv;
      mask[o] = sm * inv;
      const l = Math.hypot(nx, ny, nz) || 1;
      normals[o * 3] = nx / l;
      normals[o * 3 + 1] = ny / l;
      normals[o * 3 + 2] = nz / l;
    }
  }
  return { width, height, heightMap, mask, normals };
}

/** Full CPU render. The reference implementation the GPU path is drift-tested against. Takes the
 *  flattened, world-resolved object list (see flattenLayers). */
export function renderField(
  resolved: ResolvedObject[],
  width: number,
  height: number,
  opts: RenderOptions,
): RenderResult {
  const f = opts.supersample;
  const ctx = opts.detail ? { detail: { field: opts.detail, scale: opts.detail.scale / f } } : undefined;
  if (f === 1) {
    const field = evaluateField(resolved, width, height, ctx);
    return { ...field, normals: deriveNormals(field.heightMap, width, height) };
  }
  const hi = evaluateField(scaleResolvedForSupersample(resolved, f), width * f, height * f, ctx);
  const hiNormals = deriveNormals(hi.heightMap, hi.width, hi.height, f);
  return downsampleRender(hi, hiNormals, f);
}
