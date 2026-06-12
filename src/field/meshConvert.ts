import { frustumStrip } from "./controlPoints";
import { meshEdges } from "./meshOps";
import { getShapeType } from "./registry";
import type { MeshData, ShapeInstance } from "./types";

/** Whether a shape can currently be converted to a mesh plane (rings shapes, e.g. plateau). */
export function canConvertToMesh(shape: ShapeInstance): boolean {
  return getShapeType(shape.typeId).controlPoints.kind === "rings";
}

/**
 * Convert a rings shape (plateau) into an editable mesh plane: base ring at z=0, top ring at
 * the shape's nominal height; faces = the flat top + the slope band (the same two-ring strip the
 * plateau renders, so unequal inner/outer counts and cone/ridge tops all convert correctly). The
 * transform carries over, so scale.z / pos.z keep extruding & elevating. The smooth profile is
 * lost — a mesh is faceted by definition.
 */
export function convertToMesh(shape: ShapeInstance): ShapeInstance {
  const type = getShapeType(shape.typeId);
  if (type.controlPoints.kind !== "rings") throw new Error(`cannot convert ${shape.typeId} to mesh`);
  const h = type.nominalHeight ?? 0;
  const nB = shape.ringSplit ?? (shape.controlPoints.length >> 1); // base ring [0..nB), top ring [nB..]
  const nT = shape.controlPoints.length - nB;
  const verts = shape.controlPoints.map((p) => ({ ...p }));
  const z = verts.map((_, i) => (i < nB ? 0 : h)); // base on the ground, top rim at nominal height

  const tris: [number, number, number][] = [];
  // flat top: fan the inner ring (only when it's a real polygon; a 1/2-vert top = cone/ridge)
  for (let i = 1; i < nT - 1; i++) tris.push([nB, nB + i, nB + i + 1]);
  // slope band: the plateau's strip triangulation, mapped to global vertex indices
  const gi = (ring: number, idx: number): number => (ring === 0 ? idx : nB + idx);
  for (const [a, b, c] of frustumStrip(nB, nT).tris) {
    const t: [number, number, number] = [gi(a[0], a[1]), gi(b[0], b[1]), gi(c[0], c[1])];
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) tris.push(t); // drop the cone-apex degenerate
  }

  const mesh: MeshData = { z, tris, edges: meshEdges({ z, tris }) };
  return {
    ...shape,
    id: crypto.randomUUID(),
    typeId: "mesh",
    name: shape.name ?? type.name,
    params: { smoothness: 0 },
    ringSplit: undefined, // a mesh has no rings
    controlPoints: verts,
    mesh,
  };
}
