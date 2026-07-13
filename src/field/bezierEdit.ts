import { Vector2 } from "@carapace/primitives";
import { bakeMaskLoop, bakeRings, BezierAnchor, bezierAnchor } from "./bezier";
import { getObjectType } from "./registry";
import type { ObjectInstance } from "./types";
import { v2 } from "./vec";

/**
 * Apply an edited Bézier path to an object, REBAKING the derived controlPoints where the type
 * needs them: rings objects CSG/blend their baked rings (the optimized bake — Mesa's soft-distance
 * slope needs no ring pairing), polygon fills bake the closed loop, analytic strokes carry no
 * baked points. Every path edit — gizmo drags, context-menu ops, AND keyboard nudges — must go
 * through this, or the rendered field silently lags the gizmo.
 */
export function applyBezierEdit(
  sh: ObjectInstance,
  next: BezierAnchor[],
  starts?: { subpathStarts: number[] | undefined },
): ObjectInstance {
  const withPath = { ...sh, bezier: next, subpathStarts: starts ? starts.subpathStarts : sh.subpathStarts };
  const kind = getObjectType(sh.typeId).controlPoints.kind;
  if (kind === "rings") {
    const r = bakeRings(next, withPath.subpathStarts);
    return { ...withPath, controlPoints: r.controlPoints, ringSplit: r.ringSplit, contourCounts: r.contourCounts };
  }
  if (kind === "polygon") return { ...withPath, controlPoints: bakeMaskLoop(next) };
  return withPath; // analytic stroke: no baked controlPoints
}

/** Move anchor i to localPt. Plain move keeps it smooth (tangents re-derive); breakSymmetric pulls
 *  out symmetric manual tangents from the cursor (Alt-drag). */
export function movePoint(anchors: BezierAnchor[], i: number, localPt: Vector2, breakSymmetric: boolean): BezierAnchor[] {
  return anchors.map((a, idx) => {
    if (idx !== i) return a;
    if (breakSymmetric) {
      const h = v2(localPt.x - a.p.x, localPt.y - a.p.y);
      return { ...a, hOut: h, hIn: v2(-h.x, -h.y), mode: "manual" as const };
    }
    return { ...a, p: localPt };
  });
}

/** Drag the in/out tangent of anchor i to localPt; mirror keeps the opposite tangent symmetric.
 *  snapAngleStep (radians, e.g. 15deg) snaps the tangent's direction to multiples of that step
 *  while preserving its length — the tangent analogue of object rotate-snap (Shift). */
export function dragHandle(
  anchors: BezierAnchor[],
  i: number,
  which: "in" | "out",
  localPt: Vector2,
  mirror: boolean,
  snapAngleStep?: number,
): BezierAnchor[] {
  return anchors.map((a, idx) => {
    if (idx !== i) return a;
    let h = v2(localPt.x - a.p.x, localPt.y - a.p.y);
    if (snapAngleStep) {
      const len = Math.hypot(h.x, h.y);
      const ang = Math.round(Math.atan2(h.y, h.x) / snapAngleStep) * snapAngleStep;
      h = v2(Math.cos(ang) * len, Math.sin(ang) * len);
    }
    if (which === "out") {
      return mirror
        ? { ...a, hOut: h, hIn: v2(-h.x, -h.y), mode: "manual" as const }
        : { ...a, hOut: h, mode: "manual" as const };
    }
    return mirror
      ? { ...a, hIn: h, hOut: v2(-h.x, -h.y), mode: "manual" as const }
      : { ...a, hIn: h, mode: "manual" as const };
  });
}

/** A corner = a sharp point with NO tangents (manual mode, zero handles). */
export function isCornerAnchor(a: BezierAnchor): boolean {
  return a.mode === "manual" && a.hIn.x === 0 && a.hIn.y === 0 && a.hOut.x === 0 && a.hOut.y === 0;
}

/** Flip anchor i corner<->curve. Both directions zero the handles: a true corner becomes a smooth
 *  anchor (auto Catmull-Rom tangents re-derive from neighbours); anything with tangents (a smooth
 *  curve OR a manual cusp) becomes a sharp corner. (Editable manual handles come from dragging a
 *  tangent, not this toggle.) */
export function toggleMode(anchors: BezierAnchor[], i: number): BezierAnchor[] {
  return anchors.map((a, idx) => {
    if (idx !== i) return a;
    const mode = isCornerAnchor(a) ? ("smooth" as const) : ("manual" as const);
    return { ...a, hIn: v2(0, 0), hOut: v2(0, 0), mode };
  });
}

/** Insert a corner anchor on the closed loop, after the anchor whose outgoing edge (closed, so the
 *  last edge wraps to the first) is nearest localPt. A mask is a trim outline edited freely
 *  afterward, so we splice a plain corner at the click rather than a curve-preserving de Casteljau
 *  split — simpler and robust for any loop. Returns the new anchor's index. */
export function insertOnClosed(anchors: BezierAnchor[], localPt: Vector2): { anchors: BezierAnchor[]; index: number } | null {
  if (anchors.length < 2) return null;
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!.p;
    const b = anchors[(i + 1) % anchors.length]!.p;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((localPt.x - a.x) * abx + (localPt.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
    const dx = a.x + abx * t - localPt.x;
    const dy = a.y + aby * t - localPt.y;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  const next = anchors.slice();
  next.splice(bestI + 1, 0, bezierAnchor(v2(localPt.x, localPt.y), v2(0, 0), v2(0, 0), "manual"));
  return { anchors: next, index: bestI + 1 };
}
