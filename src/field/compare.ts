import type { RenderResult } from "./render";

export interface DriftTolerances {
  height: number;
  normal: number;
  mask: number;
}

// normal tolerance matches height: side_grad's one-sided gradients inherit GPU-vs-CPU height
// drift ~1:1 near engaged discontinuities (the old always-minmod operator suppressed it by
// favouring the flatter side and returning exactly 0 at ties, which allowed the tighter 2e-3).
// 5e-3 on a unit normal is ~1.3 8-bit steps — beneath visibility in the exported NX.
export const DEFAULT_TOLERANCES: DriftTolerances = { height: 5e-3, normal: 5e-3, mask: 2e-3 };

export interface DriftReport {
  pass: boolean;
  maxHeight: number;
  maxNormal: number;
  maxMask: number;
  /** Where the worst height drift sits + both values there — the first thing you want when a case fails. */
  heightAt?: { x: number; y: number; a: number; b: number };
}

/** Max-abs-diff comparison between two renders (GPU vs CPU reference). */
export function compareRenders(
  a: RenderResult,
  b: RenderResult,
  tol: DriftTolerances = DEFAULT_TOLERANCES,
): DriftReport {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`render dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let maxHeight = 0;
  let maxMask = 0;
  let maxNormal = 0;
  let hi = 0;
  for (let i = 0; i < a.heightMap.length; i++) {
    const dh = Math.abs(a.heightMap[i]! - b.heightMap[i]!);
    if (dh > maxHeight) {
      maxHeight = dh;
      hi = i;
    }
    maxMask = Math.max(maxMask, Math.abs(a.mask[i]! - b.mask[i]!));
  }
  for (let i = 0; i < a.normals.length; i++) {
    maxNormal = Math.max(maxNormal, Math.abs(a.normals[i]! - b.normals[i]!));
  }
  return {
    pass: maxHeight <= tol.height && maxNormal <= tol.normal && maxMask <= tol.mask,
    maxHeight,
    maxNormal,
    maxMask,
    heightAt: { x: hi % a.width, y: Math.floor(hi / a.width), a: a.heightMap[hi]!, b: b.heightMap[hi]! },
  };
}
