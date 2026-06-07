import { evaluateField } from "./evalCpu";
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
 * Full render: evaluate the fold (optionally at NxN supersampling), derive normals at the
 * high resolution, then box-filter height/mask/normals down and renormalize the normals.
 * Mirrors what the GPU export path (plan 2) must produce.
 */
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

  const hiShapes = shapes.map((s) => ({
    ...s,
    transform: {
      pos: { x: s.transform.pos.x * f, y: s.transform.pos.y * f },
      rotation: s.transform.rotation,
      scale: { x: s.transform.scale.x * f, y: s.transform.scale.y * f },
    },
    combine: { ...s.combine, blend: s.combine.blend * f },
  }));
  const hw = width * f;
  const hh = height * f;
  const hi = evaluateField(hiShapes, hw, hh);
  // slopeScale = f: heights are NOT scaled with the canvas, so hi-res gradients are f x
  // too shallow without it
  const hiNormals = deriveNormals(hi.heightMap, hw, hh, f);
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
          const i = (y * f + sy) * hw + (x * f + sx);
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
