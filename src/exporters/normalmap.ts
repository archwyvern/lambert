import { encode } from "fast-png";
import { clamp } from "../field/vec";

export const q8 = (v: number): number => Math.round(clamp(v, 0, 1) * 255);

/**
 * Generic tangent-space normal map. Input normals are image-space (y-down).
 * yUp: true = OpenGL green (g = 0.5 - n.y/2), false = DirectX green (g = 0.5 + n.y/2).
 * Blue is the generic half-range encoding (0.5 + z/2).
 */
export function encodeNormalPng(
  normals: Float32Array,
  width: number,
  height: number,
  opts: { yUp: boolean },
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const x = normals[i * 3]!;
    const y = normals[i * 3 + 1]!;
    const z = normals[i * 3 + 2]!;
    data[i * 4] = q8(0.5 + x / 2);
    data[i * 4 + 1] = q8(opts.yUp ? 0.5 - y / 2 : 0.5 + y / 2);
    data[i * 4 + 2] = q8(0.5 + z / 2);
    data[i * 4 + 3] = 255;
  }
  return encode({ width, height, data });
}
