import { Vector2 } from "@carapace/primitives";
import { snapHalf, snapToGuides } from "../field/snap";
import { v2 } from "../field/vec";

/** Screen-px catch radius for guide snapping; divided by zoom so it's constant on screen. */
const GUIDE_SNAP_PX = 6;

export interface SnapOpts {
  /** ½px grid snap (the global toolbar toggle). */
  grid: boolean;
  /** Snap to guide lines (the per-file canvas toggle). */
  guides: boolean;
  guideLines: { orient: "v" | "h"; at: number }[];
  zoom: number;
}

/**
 * Snap a world/canvas point for editing: guides win per axis (an axis that lands on a guide stays
 * exactly on it), then the ½px grid snaps any axis the guide left alone. With both toggles off the
 * point is returned unchanged, so callers can use this unconditionally at every drag site.
 */
export function snapCanvasPoint(p: Vector2, o: SnapOpts): Vector2 {
  let q = p;
  if (o.guides) q = snapToGuides(p, o.guideLines, GUIDE_SNAP_PX / o.zoom);
  if (o.grid) {
    const onGuideX = q.x !== p.x;
    const onGuideY = q.y !== p.y;
    q = v2(onGuideX ? q.x : snapHalf(q.x), onGuideY ? q.y : snapHalf(q.y));
  }
  return q;
}
