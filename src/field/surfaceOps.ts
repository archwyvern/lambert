import { DEFAULT_SURFACE_COLOR } from "./shapes/surface";
import type { ShapeInstance } from "./types";
import { v2, Vec2 } from "./vec";

/**
 * Build a Surface shape from a closed loop of canvas-space vertices. The centroid becomes the
 * transform position; vertices are stored relative to it, with one face spanning them all.
 */
export function createSurface(canvasVerts: Vec2[]): ShapeInstance {
  const n = canvasVerts.length;
  const cx = canvasVerts.reduce((a, p) => a + p.x, 0) / n;
  const cy = canvasVerts.reduce((a, p) => a + p.y, 0) / n;
  return {
    id: crypto.randomUUID(),
    typeId: "surface",
    transform: { pos: { x: cx, y: cy, z: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
    params: {},
    controlPoints: canvasVerts.map((p) => v2(p.x - cx, p.y - cy)),
    surface: { faces: [{ loop: canvasVerts.map((_, i) => i), color: DEFAULT_SURFACE_COLOR }] },
    visible: true,
    locked: false,
  };
}
