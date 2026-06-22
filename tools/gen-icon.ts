// Generates build/icon.png — the app icon: a 2x2 grid of separated solid squares in the normal-map
// channel colours (Red, Green, Blue) plus White. Run:
//   pnpm gen-icon   (then commit build/icon.png — electron-builder reads it at package time)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encode } from "fast-png";

const S = 1024; // icon edge (electron-builder downscales to every platform size)
const MARGIN = 110; // outer padding
const GAP = 72; // gap between the four squares
const TILE = (S - 2 * MARGIN - GAP) / 2;

// reading order: top-left, top-right, bottom-left, bottom-right
const tiles: { x0: number; y0: number; rgb: [number, number, number] }[] = [
  { x0: MARGIN, y0: MARGIN, rgb: [224, 49, 49] }, // Red
  { x0: MARGIN + TILE + GAP, y0: MARGIN, rgb: [47, 158, 68] }, // Green
  { x0: MARGIN, y0: MARGIN + TILE + GAP, rgb: [28, 113, 216] }, // Blue
  { x0: MARGIN + TILE + GAP, y0: MARGIN + TILE + GAP, rgb: [241, 243, 245] }, // White
];

const data = new Uint8Array(S * S * 4); // transparent by default

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const t = tiles.find((tl) => x >= tl.x0 && x < tl.x0 + TILE && y >= tl.y0 && y < tl.y0 + TILE);
    if (!t) continue; // outside every square -> transparent
    const i = (y * S + x) * 4;
    data[i] = t.rgb[0];
    data[i + 1] = t.rgb[1];
    data[i + 2] = t.rgb[2];
    data[i + 3] = 255;
  }
}

const out = path.join(import.meta.dirname, "..", "build", "icon.png");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, encode({ width: S, height: S, data, channels: 4, depth: 8 }));
console.log(`wrote ${out} (${S}x${S})`);
