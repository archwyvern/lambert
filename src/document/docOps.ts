import { Vector2, Vector3 } from "@carapace/primitives";
import type { LambertDoc } from "./schema";
import { duplicateNode, findParentId, moveNode, removeNode, siblingsOf, updateNode } from "./layerOps";
import { deleteVertices } from "../field/controlPoints";
import { deleteVerts } from "../field/meshOps";
import { createShapeInstance, getShapeType } from "../field/registry";
import { isShape, type ShapeInstance } from "../field/types";

/**
 * Remove `verts` from a shape, dispatching on its kind and guarding each kind's minimum (returns the
 * shape unchanged if the delete would make it degenerate). Mesh re-triangulates; a ring keeps outer
 * >= 3 and inner >= 1 and re-derives ringSplit; polygon >= 3, polyline >= 2. Shared by the gizmo
 * context menu and the Delete key.
 */
export function removeShapeVertices(s: ShapeInstance, verts: number[]): ShapeInstance {
  if (s.mesh) {
    const r = deleteVerts(s.controlPoints, s.mesh, verts);
    return r ? { ...s, controlPoints: r.controlPoints, mesh: r.mesh } : s;
  }
  const kind = getShapeType(s.typeId).controlPoints.kind;
  if (kind === "rings") {
    const split = s.ringSplit ?? (s.controlPoints.length >> 1);
    const outerLeft = split - verts.filter((i) => i < split).length;
    const innerLeft = s.controlPoints.length - split - verts.filter((i) => i >= split).length;
    if (outerLeft < 3 || innerLeft < 1) return s;
    const keep = deleteVertices(s.controlPoints, verts, 4);
    return keep ? { ...s, controlPoints: keep, ringSplit: outerLeft } : s;
  }
  const min = getShapeType(s.typeId).controlPoints.min ?? (kind === "polyline" ? 2 : 3);
  const keep = deleteVertices(s.controlPoints, verts, min);
  return keep ? { ...s, controlPoints: keep } : s;
}

export function addShape(doc: LambertDoc, typeId: string, pos: Vector2): LambertDoc {
  return { ...doc, layers: [...doc.layers, createShapeInstance(typeId, pos)] };
}

export function removeShape(doc: LambertDoc, id: string): LambertDoc {
  return { ...doc, layers: removeNode(doc.layers, id) };
}

export function updateShape(
  doc: LambertDoc,
  id: string,
  patch: (s: ShapeInstance) => ShapeInstance,
): LambertDoc {
  return { ...doc, layers: updateNode(doc.layers, id, (n) => (isShape(n) ? patch(n) : n)) };
}

/** Move a node by delta in z-order within its parent (+1 = later = on top). */
export function reorderShape(doc: LambertDoc, id: string, delta: number): LambertDoc {
  const parent = findParentId(doc.layers, id);
  if (parent === undefined) return doc;
  const sibs = siblingsOf(doc.layers, id);
  const idx = sibs.findIndex((n) => n.id === id);
  const to = Math.min(sibs.length - 1, Math.max(0, idx + delta));
  if (to === idx) return doc;
  return { ...doc, layers: moveNode(doc.layers, id, parent, to) };
}

/** Move a node to a final index among its siblings. */
export function moveShapeTo(doc: LambertDoc, id: string, finalIndex: number): LambertDoc {
  const parent = findParentId(doc.layers, id);
  if (parent === undefined) return doc;
  return { ...doc, layers: moveNode(doc.layers, id, parent, finalIndex) };
}

/**
 * Deep copy a shape with a fresh id, offset by (dx, dy). Mutable containers (params, control
 * points, mesh arrays) are cloned; Vector2/Vector3 are immutable so refs are safe to share.
 * structuredClone would strip the Vector class prototypes, so the copy is built by hand.
 */
export function cloneShape(src: ShapeInstance, dx = 5, dy = 5): ShapeInstance {
  return {
    ...src,
    id: crypto.randomUUID(),
    params: { ...src.params },
    controlPoints: src.controlPoints.slice(),
    bezier: src.bezier?.map((a) => ({ ...a })),
    masks: src.masks?.map((m) => ({ ...m, anchors: m.anchors.map((a) => ({ ...a })) })),
    transform: {
      ...src.transform,
      pos: new Vector3(src.transform.pos.x + dx, src.transform.pos.y + dy, src.transform.pos.z),
    },
    mesh: src.mesh
      ? {
          z: [...src.mesh.z],
          tris: src.mesh.tris.map((t) => [...t] as [number, number, number]),
          edges: src.mesh.edges?.map((e) => [...e] as [number, number]),
        }
      : undefined,
  };
}

export function duplicateShape(doc: LambertDoc, id: string): LambertDoc {
  return { ...doc, layers: duplicateNode(doc.layers, id).layers };
}
