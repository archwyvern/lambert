import { getShapeType } from "./registry";
import type { MeshData, ShapeInstance } from "./types";

/** Whether a shape can currently be converted to a mesh plane (rings shapes, e.g. plateau). */
export function canConvertToMesh(shape: ShapeInstance): boolean {
  return getShapeType(shape.typeId).controlPoints.kind === "rings";
}

/**
 * Convert a rings shape (plateau) into an editable mesh plane: base ring at z=0, top ring at
 * the shape's nominal height; faces = the flat top + the lateral slopes. The transform is
 * preserved, so scale.z / pos.z keep extruding & elevating exactly as before. The smooth
 * profile is lost — a mesh is faceted by definition.
 */
export function convertToMesh(shape: ShapeInstance): ShapeInstance {
  const type = getShapeType(shape.typeId);
  if (type.controlPoints.kind !== "rings") throw new Error(`cannot convert ${shape.typeId} to mesh`);
  const h = type.nominalHeight ?? 0;
  const n = shape.controlPoints.length >> 1; // base ring [0..n), top ring [n..2n)
  const verts = shape.controlPoints.map((p) => ({ ...p }));
  const z = verts.map((_, i) => (i < n ? 0 : h));

  const tris: [number, number, number][] = [];
  // flat top: fan-triangulate the top ring
  for (let i = 1; i < n - 1; i++) tris.push([n, n + i, n + i + 1]);
  // lateral slopes: each base edge -> top edge as a quad (two triangles)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push([i, j, n + j]);
    tris.push([i, n + j, n + i]);
  }

  const mesh: MeshData = { z, tris };
  return {
    ...shape,
    id: crypto.randomUUID(),
    typeId: "mesh",
    name: shape.name ?? type.name,
    params: {},
    controlPoints: verts,
    mesh,
  };
}
