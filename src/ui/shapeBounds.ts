import { Vector2 } from "@carapace/primitives";
import type { ShapeInstance } from "../field/types";
import { v2 } from "../field/vec";

/** Shape-local footprint bounds: control-point extents, or parametric extents from the shape's
 *  params (capsule/cylinder/frustum/dome). Shared by the shape gizmo and the group gizmo. */
export function localBounds(s: ShapeInstance): { min: Vector2; max: Vector2 } {
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
  if (s.typeId === "capsule" || s.typeId === "cylinder") {
    const r = Number(s.params.radius ?? 16);
    const ex = Number(s.params.length ?? 64) / 2 + (s.typeId === "capsule" ? r : 0);
    return { min: v2(-ex, -r), max: v2(ex, r) };
  }
  if (s.typeId === "frustum") {
    const r = Math.max(Number(s.params.radius ?? 16), Number(s.params.radius2 ?? 8));
    const ex = Number(s.params.length ?? 64) / 2;
    return { min: v2(-ex, -r), max: v2(ex, r) };
  }
  return { min: v2(-48, -48), max: v2(48, 48) }; // dome: nominal radius, ellipse via scale
}

/** The four footprint corners, CCW from min, expanded outward by pad (0 = the bare footprint).
 *  Shared gizmo-frame geometry for the shape gizmo and the group gizmo. */
export function paddedCorners(bounds: { min: Vector2; max: Vector2 }, pad: number): Vector2[] {
  return [
    v2(bounds.min.x - pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.min.y - pad),
    v2(bounds.max.x + pad, bounds.max.y + pad),
    v2(bounds.min.x - pad, bounds.max.y + pad),
  ];
}
