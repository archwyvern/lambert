import { encode } from "fast-png";
import { NormalDirs, normalSigns } from "../document/schema";
import { q16 } from "./normalmap";

/**
 * Skyrat NX override encode — 16-bit RGBA PNG (65535 levels/channel) so smooth normal gradients
 * don't band. Channel directions follow the project's NormalDirs (default red-right green-up).
 * Blue is FULL-range z. Alpha = authored mask (override only applies where alpha > 0). NOTE the
 * Skyrat reader must normalize by 65535: x=2(r/65535-.5), y=2(.5-g/65535), z=b/65535.
 */
export function encodeNxPng(
  normals: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  dirs: NormalDirs,
  opaque?: Uint8Array | null,
): Uint8Array {
  const s = normalSigns(dirs);
  const data = new Uint16Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    data[i * 4] = q16(0.5 + (s.red * normals[i * 3]!) / 2);
    data[i * 4 + 1] = q16(0.5 + (s.green * normals[i * 3 + 1]!) / 2);
    data[i * 4 + 2] = q16(normals[i * 3 + 2]!);
    // the override only applies where the diffuse has a pixel (A > 0) — clear the mask elsewhere
    data[i * 4 + 3] = q16(opaque && opaque[i] === 0 ? 0 : mask[i]!);
  }
  return encode({ width, height, data, depth: 16, channels: 4 });
}

/** Per-pixel opacity flags (1 = A>0, 0 = transparent) from a decoded image; null if no alpha channel. */
export function diffuseOpacity(img: {
  width: number;
  height: number;
  data: ArrayLike<number>;
  channels: number;
}): Uint8Array | null {
  if (img.channels !== 2 && img.channels !== 4) return null; // grayscale / RGB: no alpha = fully opaque
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = img.data[i * img.channels + (img.channels - 1)]! > 0 ? 1 : 0;
  return out;
}
