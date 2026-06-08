import { DEFAULT_SURFACE_COLOR } from "./shapes/surface";
import type { ShapeInstance, SurfaceData } from "./types";
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

/** Every edge of every face: the two endpoint vertex indices + where they sit in the loop. */
export function surfaceEdges(s: SurfaceData): Array<{ face: number; pos: number; a: number; b: number }> {
  const out: Array<{ face: number; pos: number; a: number; b: number }> = [];
  s.faces.forEach((f, face) => {
    f.loop.forEach((a, pos) => out.push({ face, pos, a, b: f.loop[(pos + 1) % f.loop.length]! }));
  });
  return out;
}

/**
 * Insert a vertex at fraction t along the edge (va, vb), into every face loop that walks that
 * edge (so a shared edge stays watertight). Returns the updated controlPoints + surface and
 * the new vertex index.
 */
export function insertVertOnEdge(
  controlPoints: Vec2[],
  surface: SurfaceData,
  va: number,
  vb: number,
  t: number,
): { controlPoints: Vec2[]; surface: SurfaceData; newIndex: number } {
  const a = controlPoints[va]!;
  const b = controlPoints[vb]!;
  const ni = controlPoints.length;
  const faces = surface.faces.map((f) => {
    const loop: number[] = [];
    f.loop.forEach((v, i) => {
      loop.push(v);
      const next = f.loop[(i + 1) % f.loop.length]!;
      if ((v === va && next === vb) || (v === vb && next === va)) loop.push(ni);
    });
    return { ...f, loop };
  });
  return {
    controlPoints: [...controlPoints, v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)],
    surface: { faces },
    newIndex: ni,
  };
}

/**
 * Delete vertices: drop them from every face loop, re-index survivors, drop faces left with
 * fewer than 3 vertices. Returns the new controlPoints + surface, or null if no face remains
 * (caller should delete the whole shape).
 */
export function deleteSurfaceVerts(
  controlPoints: Vec2[],
  surface: SurfaceData,
  remove: number[],
): { controlPoints: Vec2[]; surface: SurfaceData } | null {
  const del = new Set(remove);
  const remap = new Map<number, number>();
  const keep: number[] = [];
  controlPoints.forEach((_, i) => {
    if (!del.has(i)) {
      remap.set(i, keep.length);
      keep.push(i);
    }
  });
  const faces = surface.faces
    .map((f) => ({ ...f, loop: f.loop.filter((v) => !del.has(v)).map((v) => remap.get(v)!) }))
    .filter((f) => f.loop.length >= 3);
  if (faces.length === 0) return null;
  return { controlPoints: keep.map((i) => controlPoints[i]!), surface: { faces } };
}
