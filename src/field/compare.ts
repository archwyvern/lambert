import type { RenderResult } from "./render";

export interface DriftTolerances {
  height: number;
  normal: number;
  mask: number;
}

export const DEFAULT_TOLERANCES: DriftTolerances = { height: 5e-3, normal: 2e-3, mask: 2e-3 };

export interface DriftReport {
  pass: boolean;
  maxHeight: number;
  maxNormal: number;
  maxMask: number;
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
  for (let i = 0; i < a.heightMap.length; i++) {
    maxHeight = Math.max(maxHeight, Math.abs(a.heightMap[i]! - b.heightMap[i]!));
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
  };
}
