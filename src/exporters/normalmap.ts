import { encode } from "fast-png";
import { NormalDirs, normalXform } from "../document/schema";
import { clamp } from "../field/vec";

export const q8 = (v: number): number => Math.round(clamp(v, 0, 1) * 255);
export const q16 = (v: number): number => Math.round(clamp(v, 0, 1) * 65535);

/**
 * Generic tangent-space normal map. Input normals are image-space (y-down); channel
 * directions follow the project's NormalDirs. Blue is half-range (0.5 + z/2).
 */
export function encodeNormalPng(
  normals: Float32Array,
  width: number,
  height: number,
  dirs: NormalDirs,
): Uint8Array {
  const m = normalXform(dirs);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const nx = normals[i * 3]!;
    const ny = normals[i * 3 + 1]!;
    data[i * 4] = q8(0.5 + (m.xx * nx + m.xy * ny) / 2);
    data[i * 4 + 1] = q8(0.5 + (m.yx * nx + m.yy * ny) / 2);
    data[i * 4 + 2] = q8(0.5 + normals[i * 3 + 2]! / 2);
    data[i * 4 + 3] = 255;
  }
  return encode({ width, height, data });
}
