import { Vector2 } from "@carapace/primitives";
import { Affine, affineApply } from "./affine";
import { bakeMaskLoop, bezierAnchor } from "./bezier";
import { influence } from "./combine";
import type { ResolvedMask } from "./flatten";
import { sdPolygon } from "./sdf";
import type { Mask } from "./types";
import { v2 } from "./vec";

/** A fresh mask from clicked points (corner anchors: manual, zero handles), keep mode. AA is OFF by
 *  default (hard edge); enable it per-mask in the inspector. */
export function createMask(points: Vector2[], follow: boolean): Mask {
  return {
    id: crypto.randomUUID(),
    anchors: points.map((p) => bezierAnchor(v2(p.x, p.y), v2(0, 0), v2(0, 0), "manual")),
    mode: "keep",
    follow,
    hard: true,
  };
}

/** Bake every mask's path to its closed test polygon (parallel to `masks`). */
export function bakeMasks(masks: Mask[]): Vector2[][] {
  return masks.map((m) => bakeMaskLoop(m.anchors));
}

/**
 * Combined trim coverage at a world point. Within a scope the rule is keepCov * (1 - cutCov), where
 * keepCov defaults to 1 with no keep masks; across scopes the coverages MULTIPLY (intersect) — a
 * object shows only where its own keeps AND every ancestor group's keeps keep it. Each loop's coverage
 * is the same ½px box-filter (`influence`) over its baked polygon. follow loops test in the object's
 * resolved-local space (`invAffine` maps world->local; sd scaled by `scaleHint`); world loops test in
 * world space directly. `masks` must be scope-sorted (scope 0 first); `baked` aligns with `masks`.
 */
export function maskCoverage(
  masks: ResolvedMask[],
  baked: Vector2[][],
  invAffine: Affine,
  scaleHint: number,
  pWorld: Vector2,
): number {
  if (masks.length === 0) return 1;
  let total = 1;
  let keep = 0;
  let cut = 0;
  let hasKeep = false;
  let cur = masks[0]!.scope;
  for (let i = 0; i < masks.length; i++) {
    const m = masks[i]!;
    if (m.scope !== cur) {
      total *= (hasKeep ? keep : 1) * (1 - cut);
      keep = 0;
      cut = 0;
      hasKeep = false;
      cur = m.scope;
    }
    const pt = m.follow ? affineApply(invAffine, pWorld) : pWorld;
    const sd = sdPolygon(pt, baked[i]!) * (m.follow ? scaleHint : 1);
    // +0.5 puts the loop EDGE at the outer boundary of the affected area (full just inside, 0 at the
    // line), so the pen outline sits exactly on the mask edge instead of in the middle of the AA band.
    const cov = m.hard ? (sd <= 0 ? 1 : 0) : influence(sd + 0.5);
    if (m.mode === "cut") cut = Math.max(cut, cov);
    else {
      keep = Math.max(keep, cov);
      hasKeep = true;
    }
  }
  total *= (hasKeep ? keep : 1) * (1 - cut);
  return total;
}

/**
 * Re-express one mask's anchors in the other space (object-local <-> world) so flipping its `follow`
 * flag doesn't visually move the loop. `worldAffine`/`invWorld` are the OWNING node's RESOLVED world
 * frame ({@link nodeFrames}) — the SAME frame the eval and gizmo use, so it stays correct when the node
 * sits under transformed ancestors (a grouped object, or a nested group's own mask); the node's own
 * transform alone is not enough. Handles are offsets, so each absolute tip (p+handle) is converted and
 * the offset re-derived from the new p.
 */
export function setMaskSpace(mask: Mask, follow: boolean, worldAffine: Affine, invWorld: Affine): Mask {
  if (mask.follow === follow) return mask;
  const conv = follow
    ? (p: Vector2): Vector2 => affineApply(invWorld, p) // world -> local
    : (p: Vector2): Vector2 => affineApply(worldAffine, p); // local -> world
  const anchors = mask.anchors.map((a) => {
    const p = conv(a.p);
    const out = conv(v2(a.p.x + a.hOut.x, a.p.y + a.hOut.y));
    const inn = conv(v2(a.p.x + a.hIn.x, a.p.y + a.hIn.y));
    return { ...a, p, hOut: v2(out.x - p.x, out.y - p.y), hIn: v2(inn.x - p.x, inn.y - p.y) };
  });
  return { ...mask, follow, anchors };
}

/** Set one mask's follow flag on a node, converting its anchors through the node's world frame. */
export function setMaskFollow<T extends { masks?: Mask[] }>(
  node: T,
  maskId: string,
  follow: boolean,
  worldAffine: Affine,
  invWorld: Affine,
): T {
  if (!node.masks) return node;
  return {
    ...node,
    masks: node.masks.map((m) => (m.id === maskId ? setMaskSpace(m, follow, worldAffine, invWorld) : m)),
  };
}
