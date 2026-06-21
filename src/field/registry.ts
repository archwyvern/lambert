import type { ShapeInstance, ShapeType } from "./types";
import { Vector2, Vector3 } from "@carapace/primitives";
import { v2 } from "./vec";

const types = new Map<string, ShapeType>();

export function defineShapeType(t: ShapeType): ShapeType {
  if (types.has(t.id)) throw new Error(`duplicate shape type: ${t.id}`);
  types.set(t.id, t);
  return t;
}

export function getShapeType(id: string): ShapeType {
  const t = types.get(id);
  if (!t) throw new Error(`unknown shape type: ${id}`);
  return t;
}

export function allShapeTypes(): ShapeType[] {
  return [...types.values()];
}

export function createShapeInstance(typeId: string, pos: Vector2): ShapeInstance {
  const t = getShapeType(typeId);
  const params = Object.fromEntries(
    Object.entries(t.params).map(([key, spec]) => [key, spec.default]),
  );
  const instance: ShapeInstance = {
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
export function shapeMaxHeight(shape: ShapeInstance): number {
  if (shape.mesh) return shape.mesh.z.reduce((m, z) => Math.max(m, Math.abs(z)), 0);
  return getShapeType(shape.typeId).nominalHeight ?? 0;
}

export function numParam(shape: ShapeInstance, key: string): number {
  const value = shape.params[key];
  if (typeof value !== "number") throw new Error(`param ${key} of ${shape.typeId} is not a number`);
  return value;
}

export function enumParam(shape: ShapeInstance, key: string): string {
  const value = shape.params[key];
  if (typeof value !== "string") throw new Error(`param ${key} of ${shape.typeId} is not a string`);
  return value;
}
