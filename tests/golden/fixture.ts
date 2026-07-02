export { goldenObjects, GOLDEN_W, GOLDEN_H } from "../../src/field/fixtures";
import { GOLDEN_W, GOLDEN_H } from "../../src/field/fixtures";
import type { NormalDirs } from "../../src/document/schema";

// A second golden variant the default one doesn't cover: a FLIPPED green channel (green: "down") plus
// a diffuse with a transparent LEFT third, so both the NX alpha gate (opaque[i] === 0 -> mask 0) and a
// non-default normal direction are byte-locked. Shared by gen.ts and golden.test.ts.
export const GATED_DIRS: NormalDirs = { red: "right", green: "down" };

/** Per-pixel opacity for the gated golden: left third transparent (gated out), the rest opaque. */
export function gatedOpaque(): Uint8Array {
  const out = new Uint8Array(GOLDEN_W * GOLDEN_H).fill(1);
  for (let y = 0; y < GOLDEN_H; y++) {
    for (let x = 0; x < GOLDEN_W; x++) {
      if (x < GOLDEN_W / 3) out[y * GOLDEN_W + x] = 0;
    }
  }
  return out;
}
