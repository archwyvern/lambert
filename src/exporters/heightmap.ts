import { encode } from "fast-png";
import type { FieldResult } from "../field/evalCpu";

/** 16-bit grayscale, heights normalized [min, max] -> [0, 65535]. */
export function encodeHeightmapPng(field: FieldResult): Uint8Array {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of field.heightMap) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn || 1;
  const data = new Uint16Array(field.width * field.height);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.round(((field.heightMap[i]! - mn) / range) * 65535);
  }
  return encode({ width: field.width, height: field.height, data, depth: 16, channels: 1 });
}
