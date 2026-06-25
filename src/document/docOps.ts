import { Vector2, Vector3 } from "@carapace/primitives";
import type { LambertDoc } from "./schema";
import { duplicateNode, findParentId, moveNode, removeNode, siblingsOf, updateNode } from "./layerOps";
import { deleteVertices } from "../field/controlPoints";
import { deleteVerts } from "../field/meshOps";
import { createObjectInstance, getObjectType } from "../field/registry";
import { isObject, type ObjectInstance } from "../field/types";

/**
 * Remove `verts` from an object, dispatching on its kind and guarding each kind's minimum (returns the
 * object unchanged if the delete would make it degenerate). Mesh re-triangulates; a ring keeps outer
 * >= 3 and inner >= 1 and re-derives ringSplit; polygon >= 3, polyline >= 2. Shared by the gizmo
 * context menu and the Delete key.
 */
export function removeObjectVertices(s: ObjectInstance, verts: number[]): ObjectInstance {
  if (s.mesh) {
    const r = deleteVerts(s.controlPoints, s.mesh, verts);
    return r ? { ...s, controlPoints: r.controlPoints, mesh: r.mesh } : s;
  }
  const kind = getObjectType(s.typeId).controlPoints.kind;
  if (kind === "rings") {
    const split = s.ringSplit ?? (s.controlPoints.length >> 1);
    const outerLeft = split - verts.filter((i) => i < split).length;
    const innerLeft = s.controlPoints.length - split - verts.filter((i) => i >= split).length;
    if (outerLeft < 3 || innerLeft < 1) return s;
    const keep = deleteVertices(s.controlPoints, verts, 4);
    return keep ? { ...s, controlPoints: keep, ringSplit: outerLeft } : s;
  }
  const min = getObjectType(s.typeId).controlPoints.min ?? (kind === "polyline" ? 2 : 3);
  const keep = deleteVertices(s.controlPoints, verts, min);
  return keep ? { ...s, controlPoints: keep } : s;
}

export function addObject(doc: LambertDoc, typeId: string, pos: Vector2): LambertDoc {
  return { ...doc, layers: [...doc.layers, createObjectInstance(typeId, pos)] };
}

/** Append a pre-built object instance (e.g. one created from a palette preset). */
export function addInstance(doc: LambertDoc, object: ObjectInstance): LambertDoc {
  return { ...doc, layers: [...doc.layers, object] };
}

export function removeObject(doc: LambertDoc, id: string): LambertDoc {
  return { ...doc, layers: removeNode(doc.layers, id) };
}

export function updateObject(
  doc: LambertDoc,
  id: string,
  patch: (s: ObjectInstance) => ObjectInstance,
): LambertDoc {
  return { ...doc, layers: updateNode(doc.layers, id, (n) => (isObject(n) ? patch(n) : n)) };
}

/** Move a node by delta in z-order within its parent (+1 = later = on top). */
export function reorderObject(doc: LambertDoc, id: string, delta: number): LambertDoc {
  const parent = findParentId(doc.layers, id);
  if (parent === undefined) return doc;
  const sibs = siblingsOf(doc.layers, id);
  const idx = sibs.findIndex((n) => n.id === id);
  const to = Math.min(sibs.length - 1, Math.max(0, idx + delta));
  if (to === idx) return doc;
  return { ...doc, layers: moveNode(doc.layers, id, parent, to) };
}

/** Move a node to a final index among its siblings. */
export function moveObjectTo(doc: LambertDoc, id: string, finalIndex: number): LambertDoc {
  const parent = findParentId(doc.layers, id);
  if (parent === undefined) return doc;
  return { ...doc, layers: moveNode(doc.layers, id, parent, finalIndex) };
}

/**
 * Deep copy an object with a fresh id, offset by (dx, dy). Mutable containers (params, control
 * points, mesh arrays) are cloned; Vector2/Vector3 are immutable so refs are safe to share.
 * structuredClone would strip the Vector class prototypes, so the copy is built by hand.
 */
export function cloneObject(src: ObjectInstance, dx = 5, dy = 5): ObjectInstance {
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

export function duplicateObject(doc: LambertDoc, id: string): LambertDoc {
  return { ...doc, layers: duplicateNode(doc.layers, id).layers };
}
