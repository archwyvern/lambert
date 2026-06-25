import { Vector2 } from "@carapace/primitives";
import { bakeRings, bakeRingsUniform, bezierAnchor } from "./bezier";
import { meshEdges } from "./meshOps";
import { getObjectType, ObjectTypeId } from "./registry";
import type { ObjectInstance } from "./types";
import { v2 } from "./vec";

/** Primitive types that have a Bézier "(Vector)" twin (so "Convert to Vector" applies). */
export const VECTOR_CONVERTIBLE = new Set<string>([ObjectTypeId.Pipe, ObjectTypeId.Berm, ObjectTypeId.Surface, ObjectTypeId.Plateau]);

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
    case ObjectTypeId.Pipe: {
      const half = num("length", 64) / 2;
      const r0 = num("radius", 16);
      const r1 = num("radius2", 16);
      const taper = r1 !== r0; // a Frustum: carry the two end radii as per-anchor widths
      return {
        ...common,
        typeId: ObjectTypeId.PipeVector,
        controlPoints: [],
        bezier: [
          { ...bezierAnchor(v2(-half, 0)), ...(taper ? { radius: r0 } : {}) },
          { ...bezierAnchor(v2(half, 0)), ...(taper ? { radius: r1 } : {}) },
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
      const r = bakeRingsUniform(bezier, subpathStarts); // equal dense counts -> clean paired loft (no fan)
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

/** Grid cells per axis for a bake. (n+1)² vertices, 2n² triangles. A balance between shape fidelity
 *  and the mesh field's O(triangles) per-pixel cost. */
const BAKE_N = 16;

/**
 * Bake an object's height field to an editable triangle Mesh over the given local footprint bounds.
 * Samples the source object's eval on a regular grid spanning the bounds (padded), producing a plain
 * Mesh with the SAME transform — so the primitive's (or vector's) shape becomes freely sculptable.
 * Any object can convert to a Mesh; the reverse is impossible (a triangle field isn't a parametric or
 * Bézier form).
 */
export function bakeToMesh(object: ObjectInstance, bounds: { min: Vector2; max: Vector2 }): ObjectInstance {
  const type = getObjectType(object.typeId);
  const pad = 2; // capture the footprint edge (height falls to 0 just outside)
  const minX = bounds.min.x - pad;
  const minY = bounds.min.y - pad;
  const maxX = bounds.max.x + pad;
  const maxY = bounds.max.y + pad;
  const n = BAKE_N;
  const controlPoints: Vector2[] = [];
  const z: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const p = v2(minX + ((maxX - minX) * i) / n, minY + ((maxY - minY) * j) / n);
      controlPoints.push(p);
      z.push(type.eval(p, object).height);
    }
  }
  const idx = (i: number, j: number): number => j * (n + 1) + i;
  const tris: [number, number, number][] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      tris.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
      tris.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
    }
  }
  const mesh = { z, tris, edges: meshEdges({ z, tris }) };
  return {
    ...object,
    typeId: ObjectTypeId.Mesh,
    controlPoints,
    mesh,
    bezier: undefined,
    closed: undefined,
    ringSplit: undefined,
    params: { smoothness: 0 },
  };
}
