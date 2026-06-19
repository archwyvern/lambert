import { applyProfile, ProfileKind } from "../profiles";
import { sdSegment } from "../sdf";
import type { FieldSample } from "../types";
import type { Vector2 } from "@carapace/primitives";

/** Shared eval for spine-based shapes: distance to a polyline, profiled over slopeWidth. The
 *  footprint half-width and the profile's slope width are separate — pass slopeWidth < halfWidth
 *  for a flat-topped cross-section (ramp over slopeWidth, flat the rest). Defaults to halfWidth. */
export function spineEval(
  p: Vector2,
  spine: Vector2[],
  halfWidth: number,
  height: number,
  profile: ProfileKind,
  slopeWidth: number = halfWidth,
): FieldSample {
  let d = Infinity;
  for (let i = 0; i + 1 < spine.length; i++) {
    d = Math.min(d, sdSegment(p, spine[i]!, spine[i + 1]!));
  }
  const sd = d - halfWidth;
  return { height: height * applyProfile(profile, -sd, slopeWidth), sd };
}
