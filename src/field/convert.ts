import { Vector2 } from "@carapace/primitives";
import { bakeRings, bezierAnchor } from "./bezier";
import { frustumStrip } from "./controlPoints";
import { meshEdges } from "./meshOps";
import { ObjectTypeId } from "./registry";
import type { ObjectInstance } from "./types";
import { v2 } from "./vec";

/** Primitive types that have a Bézier "(Vector)" twin (so "Convert to Vector" applies). */
export const VECTOR_CONVERTIBLE = new Set<string>([ObjectTypeId.Pipe, ObjectTypeId.Berm, ObjectTypeId.Surface, ObjectTypeId.Plateau, ObjectTypeId.Sphere]);

const corner = (p: Vector2) => bezierAnchor(v2(p.x, p.y), v2(0, 0), v2(0, 0), "manual");

/**
 * Convert a primitive to its Bézier "(Vector)" twin (same shape, now path-editable). Bars become a
 * 2-anchor straight stroke; a Surface polygon becomes a closed corner loop. Returns null for a type
 * with no twin. (Mesh ↔ Vector is impossible; a uniform stroke can't carry a Frustum's radius taper.)
 */
export function convertToVector(object: ObjectInstance): ObjectInstance | null {
  const num = (k: string, d: number): number => (typeof object.params[k] === "number" ? (object.params[k] as number) : d);
  const str = (k: string, d: string): string => (typeof object.params[k] === "string" ? (object.params[k] as string) : d);
  const common = { ...object, mesh: undefined, ringSplit: undefined };
  switch (object.typeId) {
    case ObjectTypeId.Sphere: {
      // Sphere -> Pillow: its Path form. A 4-anchor Bezier circle (kappa handles); inflate = the
      // sphere's radius and the profile carries over, so the relief stays close — now freely editable.
      const r = num("radius", 48);
      const k = r * 0.5523;
      const circle = [
        bezierAnchor(v2(-r, 0), v2(0, k), v2(0, -k), "manual"),
        bezierAnchor(v2(0, -r), v2(-k, 0), v2(k, 0), "manual"),
        bezierAnchor(v2(r, 0), v2(0, -k), v2(0, k), "manual"),
        bezierAnchor(v2(0, r), v2(k, 0), v2(-k, 0), "manual"),
      ];
      const b = bakeRings(circle, undefined);
      return {
        ...common,
        typeId: ObjectTypeId.Pillow,
        bezier: circle,
        closed: true,
        controlPoints: b.controlPoints,
        ringSplit: b.ringSplit,
        contourCounts: b.contourCounts,
        params: { inflate: r, profile: object.params.profile ?? "round" },
      };
    }
    case ObjectTypeId.Pipe: {
      const half = num("length", 64) / 2;
      const r0 = num("radius", 16);
      const r1 = num("radius2", 16);
      const taper = r1 !== r0 && r0 > 0; // a Frustum: carry the taper as per-anchor cross-section scales
      return {
        ...common,
        typeId: ObjectTypeId.PipeVector,
        controlPoints: [],
        bezier: [
          bezierAnchor(v2(-half, 0)),
          { ...bezierAnchor(v2(half, 0)), ...(taper ? { scale: r1 / r0 } : {}) },
        ],
        closed: undefined,
        params: { radius: r0, profile: str("profile", "round"), cap: str("cap", "round"), invert: "raise" },
      };
    }
    case ObjectTypeId.Berm: {
      const half = num("length", 80) / 2;
      return {
        ...common,
        typeId: ObjectTypeId.BermVector,
        controlPoints: [],
        bezier: [bezierAnchor(v2(-half, 0)), bezierAnchor(v2(half, 0))],
        closed: undefined,
        params: { width: num("width", 16), slope: num("slope", 6), height: num("height", 12), cap: str("cap", "flat"), invert: "raise" },
      };
    }
    case ObjectTypeId.Surface: {
      const loop = object.controlPoints.map(corner); // straight corner loop == the polygon
      const r = bakeRings(loop, undefined); // single ring -> ringSplit = whole (no hole)
      return { ...common, typeId: ObjectTypeId.SurfaceVector, bezier: loop, closed: true, controlPoints: r.controlPoints, ringSplit: r.ringSplit, contourCounts: r.contourCounts };
    }
    case ObjectTypeId.Plateau: {
      const nB = object.ringSplit ?? object.controlPoints.length >> 1;
      const base = object.controlPoints.slice(0, nB).map(corner);
      const top = object.controlPoints.slice(nB).map(corner);
      const bezier = [...base, ...top];
      const subpathStarts = [0, base.length];
      const r = bakeRings(bezier, subpathStarts); // Mesa's soft-distance slope needs no ring pairing
      return {
        ...common,
        typeId: ObjectTypeId.PlateauVector,
        bezier,
        subpathStarts,
        closed: true,
        controlPoints: r.controlPoints,
        ringSplit: r.ringSplit,
        contourCounts: r.contourCounts,
      };
    }
    default:
      return null;
  }
}

/** Flat/faceted types that offer "Convert to Mesh". A triangulated CURVED surface bands under
 *  lighting (defeats the mesh's purpose), so curved primitives convert to Vectors instead. */
export const MESH_CONVERTIBLE = new Set<string>([ObjectTypeId.Surface, ObjectTypeId.Plateau]);

/** Whether THIS instance can bake: a mesh-convertible type, minus holed Surfaces (a Mesh has no
 *  hole topology, so the holes would silently vanish). */
export function canBakeToMesh(object: ObjectInstance): boolean {
  if (!MESH_CONVERTIBLE.has(object.typeId)) return false;
  if (object.typeId === ObjectTypeId.Surface && (object.contourCounts?.length ?? 1) > 1) return false;
  return true;
}

/** Ear-clip a simple polygon (either winding) into triangles over its own vertex indices. O(n^2) —
 *  fine at control-point counts. Falls back to a fan if the polygon is degenerate/self-intersecting. */
function earClip(pts: Vector2[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  const cross = (a: Vector2, b: Vector2, c: Vector2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const idx = pts.map((_, i) => i);
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length]!;
      const i1 = idx[k]!;
      const i2 = idx[(k + 1) % idx.length]!;
      const a = pts[i0]!;
      const b = pts[i1]!;
      const c = pts[i2]!;
      if (cross(a, b, c) * sign <= 0) continue; // reflex/degenerate corner — not an ear
      let contains = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const q = pts[j]!;
        if (cross(a, b, q) * sign >= 0 && cross(b, c, q) * sign >= 0 && cross(c, a, q) * sign >= 0) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // bad geometry: fan what's left below
  }
  for (let k = 1; k < idx.length - 1; k++) tris.push([idx[0]!, idx[k]!, idx[k + 1]!]);
  return tris;
}

const asMesh = (object: ObjectInstance, controlPoints: Vector2[], z: number[], tris: [number, number, number][]): ObjectInstance => ({
  ...object,
  typeId: ObjectTypeId.Mesh,
  controlPoints,
  mesh: { z, tris, edges: meshEdges({ z, tris }) },
  bezier: undefined,
  closed: undefined,
  ringSplit: undefined,
  subpathStarts: undefined,
  contourCounts: undefined,
  params: { smoothness: 0 },
});

/**
 * Convert a flat/faceted object to a MINIMAL, exact triangle Mesh (one-way; see canBakeToMesh):
 * - Surface -> its polygon ear-clipped over the existing vertices (a quad = 2 triangles), each vertex
 *   at the tilt plane's height — planar triangles reproduce the tilt exactly.
 * - Plateau -> base ring at 0 + top ring at full height, sides from the SAME frustumStrip pairing the
 *   loft renders with, plus an ear-clipped top cap. Exact for the linear profile; curved profiles
 *   flatten to their facet planes (the faceted interpretation of the same shape).
 * (The old implementation resampled ANY object on a fixed 16x16 grid — 512 triangles for a flat quad.)
 */
export function bakeToMesh(object: ObjectInstance): ObjectInstance {
  if (object.typeId === ObjectTypeId.Plateau) {
    const cps = object.controlPoints;
    const nB = object.ringSplit ?? cps.length >> 1;
    const outer = cps.slice(0, nB);
    const inner = cps.slice(nB);
    const H = 24; // the plateau's nominal height (tallness scaling rides transform.scale.z, unchanged)
    const z = [...outer.map(() => 0), ...inner.map(() => H)];
    const tris: [number, number, number][] = frustumStrip(nB, inner.length).map(([a, b, c]) => [
      a[0] === 0 ? a[1] : nB + a[1],
      b[0] === 0 ? b[1] : nB + b[1],
      c[0] === 0 ? c[1] : nB + c[1],
    ]);
    for (const [i0, i1, i2] of earClip(inner)) tris.push([nB + i0, nB + i1, nB + i2]); // top cap (apex fans skip it)
    return asMesh(object, [...outer, ...inner], z, tris);
  }
  // Surface: the outer polygon at its tilt plane (untilted = flat at 0)
  const nB = object.contourCounts?.[0] ?? object.ringSplit ?? object.controlPoints.length;
  const outer = object.controlPoints.slice(0, nB);
  const tx = typeof object.params.tiltX === "number" ? object.params.tiltX : 0;
  const ty = typeof object.params.tiltY === "number" ? object.params.tiltY : 0;
  let minDot = Infinity;
  for (const q of outer) minDot = Math.min(minDot, q.x * tx + q.y * ty);
  if (!Number.isFinite(minDot)) minDot = 0;
  const z = outer.map((q) => q.x * tx + q.y * ty - minDot);
  return asMesh(object, outer, z, earClip(outer));
}
