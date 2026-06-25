import { Vector2 } from "@carapace/primitives";
import { ObjectTypeId } from "../field/objectTypeIds";
import type { ObjectInstance } from "../field/types";
import { v2 } from "../field/vec";

/** Object-local footprint bounds: control-point extents, or parametric extents from the object's
 *  params (pipe = length/radius/cap, sphere = radius, torus = fixed). Shared by the object + group gizmo. */
export function localBounds(s: ObjectInstance): { min: Vector2; max: Vector2 } {
  if (s.controlPoints.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of s.controlPoints) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { min: v2(minX, minY), max: v2(maxX, maxY) };
  }
  if (s.typeId === ObjectTypeId.Pipe) {
    const r = Math.max(Number(s.params.radius ?? 16), Number(s.params.radius2 ?? 16));
    const round = s.params.cap === "round";
    const ex = Number(s.params.length ?? 64) / 2 + (round ? r : 0); // round caps bulge past the ends
    return { min: v2(-ex, -r), max: v2(ex, r) };
  }
  if (s.typeId === ObjectTypeId.Sphere) {
    const r = Number(s.params.radius ?? 48);
    return { min: v2(-r, -r), max: v2(r, r) };
  }
  if (s.typeId === ObjectTypeId.Torus) {
    return { min: v2(-64, -64), max: v2(64, 64) }; // major radius 48 + tube radius 16
  }
  return { min: v2(-48, -48), max: v2(48, 48) }; // pyramid / ramp: 48px half-extent footprint
}

/** The four footprint corners, CCW from min, expanded outward by pad (0 = the bare footprint).
 *  Shared gizmo-frame geometry for the object gizmo and the group gizmo. */
export function paddedCorners(bounds: { min: Vector2; max: Vector2 }, pad: number): Vector2[] {
  return [
    v2(bounds.min.x - pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.max.y + pad),
    v2(bounds.min.x - pad, bounds.max.y + pad),
  ];
}
