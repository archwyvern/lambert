import { clamp } from "./vec";

/**
 * Central-difference normals from a height field, edge-clamped.
 * Image space: x right, y down, z out — n = normalize(-dH/dx, -dH/dy, 1).
 * slopeScale multiplies the gradients (used by supersampled rendering, where the canvas is
 * scaled up but heights are not). Output is packed xyz triplets, row-major.
 */
export function deriveNormals(
  heightMap: Float32Array,
  width: number,
  height: number,
  slopeScale = 1,
): Float32Array {
  const out = new Float32Array(width * height * 3);
  const at = (x: number, y: number): number =>
    heightMap[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = ((at(x + 1, y) - at(x - 1, y)) / 2) * slopeScale;
      const dy = ((at(x, y + 1) - at(x, y - 1)) / 2) * slopeScale;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 3;
      out[i] = -dx * inv;
      out[i + 1] = -dy * inv;
      out[i + 2] = inv;
    }
  }
  return out;
}
