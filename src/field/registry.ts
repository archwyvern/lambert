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
    transform: { pos, rotation: 0, scale: v2(1, 1) },
    params,
    controlPoints: t.controlPoints.default.map((p) => ({ ...p })),
    combine: { op: t.defaultCombine ?? "raise", blend: 0 },
    strength: 1,
    visible: true,
    locked: false,
  };
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
