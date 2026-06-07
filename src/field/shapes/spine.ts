import { applyProfile, ProfileKind } from "../profiles";
import { sdSegment } from "../sdf";
import type { FieldSample } from "../types";
import type { Vec2 } from "../vec";

/** Shared eval for spine-based shapes: distance to a polyline, profiled over halfWidth. */
export function spineEval(
  p: Vec2,
  spine: Vec2[],
  halfWidth: number,
  height: number,
  profile: ProfileKind,
): FieldSample {
  let d = Infinity;
  for (let i = 0; i + 1 < spine.length; i++) {
    d = Math.min(d, sdSegment(p, spine[i]!, spine[i + 1]!));
  }
  const sd = d - halfWidth;
  return { height: height * applyProfile(profile, -sd, halfWidth), sd };
}
