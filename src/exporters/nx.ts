import { encode } from "fast-png";
import { NormalDirs, normalSigns } from "../document/schema";
import { q8 } from "./normalmap";

/**
 * Skyrat NX override encode. Channel directions follow the project's NormalDirs
 * (default red-right green-up, matching the artist's hand-painted NX files — the
 * authority on the pipeline's convention). Blue is FULL-range z (not 0.5+z/2).
 * Alpha = authored mask — the override only replaces the generator's bevel where
 * alpha > 0.
 */
export function encodeNxPng(
  normals: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  dirs: NormalDirs,
): Uint8Array {
  const s = normalSigns(dirs);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    data[i * 4] = q8(0.5 + (s.red * normals[i * 3]!) / 2);
    data[i * 4 + 1] = q8(0.5 + (s.green * normals[i * 3 + 1]!) / 2);
    data[i * 4 + 2] = q8(normals[i * 3 + 2]!);
    data[i * 4 + 3] = q8(mask[i]!);
  }
  return encode({ width, height, data });
}

/** hull.df.png -> hull.nx.png; hull.png -> hull.nx.png (strip a .df tag if present). */
export function nxFileName(diffuseName: string): string {
  const m = diffuseName.match(/^(.*?)(\.df)?\.png$/i);
  if (!m) throw new Error(`not a png filename: ${diffuseName}`);
  return `${m[1]}.nx.png`;
}
