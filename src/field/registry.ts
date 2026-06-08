import type { ShapeInstance, ShapeType } from "./types";
import { Vec2, v2 } from "./vec";

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

export function createShapeInstance(typeId: string, pos: Vec2): ShapeInstance {
  const t = getShapeType(typeId);
  const params = Object.fromEntries(
    Object.entries(t.params).map(([key, spec]) => [key, spec.default]),
  );
  return {
    id: crypto.randomUUID(),
    typeId,
    transform: { pos: { x: pos.x, y: pos.y, z: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
    params,
    controlPoints: t.controlPoints.default.map((p) => ({ ...p })),
    visible: true,
    locked: false,
  };
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
