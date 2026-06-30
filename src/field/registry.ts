import { isGroup, type LayerNode, type ObjectInstance, type ObjectType } from "./types";
import { Vector2, Vector3 } from "@carapace/primitives";
import { v2 } from "./vec";

export { ObjectTypeId } from "./objectTypeIds";
export type { ObjectTypeIdValue } from "./objectTypeIds";

const types = new Map<string, ObjectType>();

export function defineObjectType(t: ObjectType): ObjectType {
  if (types.has(t.id)) throw new Error(`duplicate object type: ${t.id}`);
  types.set(t.id, t);
  return t;
}

export function getObjectType(id: string): ObjectType {
  const t = types.get(id);
  if (!t) throw new Error(`unknown object type: ${id}`);
  return t;
}

/** Whether a type id is registered. */
export function hasObjectType(id: string): boolean {
  return types.has(id);
}

/**
 * Graceful degrade on load: drop object layers whose type isn't registered (legacy/removed types
 * from before a model change), so an unrecognized layer is deleted rather than crashing the render.
 * Groups are kept and recursed into.
 */
export function dropUnknownLayers(layers: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  for (const n of layers) {
    if (isGroup(n)) out.push({ ...n, children: dropUnknownLayers(n.children) });
    else if (hasObjectType(n.typeId)) out.push(n);
    // else: unrecognized object type → dropped
  }
  return out;
}

export function allObjectTypes(): ObjectType[] {
  return [...types.values()];
}

export function createObjectInstance(typeId: string, pos: Vector2): ObjectInstance {
  const t = getObjectType(typeId);
  const params = Object.fromEntries(
    Object.entries(t.params).map(([key, spec]) => [key, spec.default]),
  );
  const instance: ObjectInstance = {
    id: crypto.randomUUID(),
    typeId,
    transform: { pos: new Vector3(pos.x, pos.y, 0), rotation: 0, scale: Vector3.one },
    params,
    controlPoints: t.controlPoints.default.map((p) => v2(p.x, p.y)),
    visible: true,
    locked: false,
  };
  t.onCreate?.(instance);
  return instance;
}

/** Peak |height| in px at scale.z = 1: the type's nominal, or the mesh's tallest vertex. */
export function objectMaxHeight(object: ObjectInstance): number {
  if (object.mesh) return object.mesh.z.reduce((m, z) => Math.max(m, Math.abs(z)), 0);
  return getObjectType(object.typeId).nominalHeight ?? 0;
}

export function numParam(object: ObjectInstance, key: string): number {
  const value = object.params[key];
  if (typeof value !== "number") throw new Error(`param ${key} of ${object.typeId} is not a number`);
  return value;
}

export function enumParam(object: ObjectInstance, key: string): string {
  const value = object.params[key];
  if (typeof value !== "string") throw new Error(`param ${key} of ${object.typeId} is not a string`);
  return value;
}
