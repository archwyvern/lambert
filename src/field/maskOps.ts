import { Vector2 } from "@carapace/primitives";
import { Affine, affineApply } from "./affine";
import { bakeMaskLoop, bezierAnchor } from "./bezier";
import { influence } from "./combine";
import type { ResolvedMask } from "./flatten";
import { sdPolygon } from "./sdf";
import { fromLocal, toLocal } from "./transform";
import type { Mask, ShapeInstance } from "./types";
import { v2 } from "./vec";

/** A fresh mask from clicked points (corner anchors: manual, zero handles), keep mode. */
export function createMask(points: Vector2[], follow: boolean): Mask {
  return {
    id: crypto.randomUUID(),
    anchors: points.map((p) => bezierAnchor(v2(p.x, p.y), v2(0, 0), v2(0, 0), "manual")),
    mode: "keep",
    follow,
  };
}

/** Bake every mask's path to its closed test polygon (parallel to `masks`). */
export function bakeMasks(masks: Mask[]): Vector2[][] {
  return masks.map((m) => bakeMaskLoop(m.anchors));
}

/**
 * Combined trim coverage at a world point. Within a scope the rule is keepCov * (1 - cutCov), where
 * keepCov defaults to 1 with no keep masks; across scopes the coverages MULTIPLY (intersect) — a
 * shape shows only where its own keeps AND every ancestor group's keeps keep it. Each loop's coverage
 * is the same ½px box-filter (`influence`) over its baked polygon. follow loops test in the shape's
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
 * Toggle a mask's follow flag, converting its anchor coords through the node's CURRENT transform so
 * the loop does not visually jump: local<->world for the point and for each handle's absolute tip
 * (handles are offsets, so convert p+handle then subtract the new p). Works on any node with a
 * transform + masks (a shape or a group).
 */
export function setMaskFollow<T extends { transform: ShapeInstance["transform"]; masks?: Mask[] }>(
  shape: T,
  maskId: string,
  follow: boolean,
): T {
  if (!shape.masks) return shape;
  const conv = follow
    ? (p: Vector2): Vector2 => toLocal(shape.transform, p)
    : (p: Vector2): Vector2 => fromLocal(shape.transform, p);
  const masks = shape.masks.map((m) => {
    if (m.id !== maskId || m.follow === follow) return m;
    const anchors = m.anchors.map((a) => {
      const p = conv(a.p);
      const out = conv(v2(a.p.x + a.hOut.x, a.p.y + a.hOut.y));
      const inn = conv(v2(a.p.x + a.hIn.x, a.p.y + a.hIn.y));
      return { ...a, p, hOut: v2(out.x - p.x, out.y - p.y), hIn: v2(inn.x - p.x, inn.y - p.y) };
    });
    return { ...m, follow, anchors };
  });
  return { ...shape, masks };
}
