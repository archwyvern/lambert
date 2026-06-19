import { Vector3 } from "@carapace/primitives";
import { evaluateField, FieldResult } from "./evalCpu";
import { deriveNormals } from "./normals";
import type { ShapeInstance } from "./types";

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
}

/**
 * Scale shape instances onto a canvas f times larger: positions, scales, and blends
 * multiply by f so footprints keep their relative area. Heights are NOT scaled — the
 * normal derivation compensates with slopeScale = f.
 */
export function scaleShapesForSupersample(shapes: ShapeInstance[], f: number): ShapeInstance[] {
  return shapes.map((s) => ({
    ...s,
    transform: {
      pos: new Vector3(s.transform.pos.x * f, s.transform.pos.y * f, s.transform.pos.z),
      rotation: s.transform.rotation,
      // z (tallness) does NOT scale with the canvas: heights stay put, slopeScale corrects
      scale: new Vector3(s.transform.scale.x * f, s.transform.scale.y * f, s.transform.scale.z),
    },
  }));
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

/** Full CPU render. The reference implementation the GPU path is drift-tested against. */
export function renderField(
  shapes: ShapeInstance[],
  width: number,
  height: number,
  opts: RenderOptions,
): RenderResult {
  const f = opts.supersample;
  if (f === 1) {
    const field = evaluateField(shapes, width, height);
    return { ...field, normals: deriveNormals(field.heightMap, width, height) };
  }
  const hi = evaluateField(scaleShapesForSupersample(shapes, f), width * f, height * f);
  const hiNormals = deriveNormals(hi.heightMap, hi.width, hi.height, f);
  return downsampleRender(hi, hiNormals, f);
}
