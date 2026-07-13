import { Vector2 } from "@aphralatrax/primitives";
import { bezierSpine } from "./bezier";
import { ObjectTypeId } from "./objectTypeIds";
import type { ObjectInstance } from "./types";
import { v2 } from "./vec";

/** Object-local footprint bounds: control-point extents, analytic-stroke bezier extents, or parametric
 *  extents from the object's params (pipe = length/radius/cap, sphere = radius, torus = fixed). Shared by
 *  the object + group gizmo. */
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
  if (s.bezier && s.bezier.length > 0) {
    // analytic stroke vectors (Cable/Ridge) carry their path in `bezier` with NO baked
    // controlPoints. Bound the SAMPLED curve (not the control-point hull — tangent handles sit off the
    // curve and would balloon the box), padded by the cross-section, so the gizmo box hugs the swept
    // stroke instead of the fixed default box (which scaled but never wrapped the anchors).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of bezierSpine(s.bezier, 24, s.closed)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    // cross-section half-extent (pipe radius / berm width) x the LARGEST per-anchor taper scale —
    // the bounds are also the GPU fold's cull box, so they must be conservative, not cosmetic
    const maxTaper = s.bezier.reduce((m, a) => Math.max(m, a.scale ?? 1), 1);
    const pad = Number(s.params.radius ?? s.params.width ?? 8) * maxTaper;
    return { min: v2(minX - pad, minY - pad), max: v2(maxX + pad, maxY + pad) };
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
  if (s.typeId === ObjectTypeId.Berm) {
    const w = Number(s.params.width ?? 16);
    const ex = Number(s.params.length ?? 80) / 2 + (s.params.cap === "flat" ? 0 : w); // round caps bulge
    return { min: v2(-ex, -w), max: v2(ex, w) };
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
