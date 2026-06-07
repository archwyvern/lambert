import type { FlatlandDoc } from "./schema";
import { createShapeInstance } from "../field/registry";
import type { ShapeInstance } from "../field/types";
import { Vec2, v2 } from "../field/vec";

export function addShape(doc: FlatlandDoc, typeId: string, pos: Vec2): FlatlandDoc {
  return { ...doc, shapes: [...doc.shapes, createShapeInstance(typeId, pos)] };
}

export function removeShape(doc: FlatlandDoc, id: string): FlatlandDoc {
  return { ...doc, shapes: doc.shapes.filter((s) => s.id !== id) };
}

export function updateShape(
  doc: FlatlandDoc,
  id: string,
  patch: (s: ShapeInstance) => ShapeInstance,
): FlatlandDoc {
  return { ...doc, shapes: doc.shapes.map((s) => (s.id === id ? patch(s) : s)) };
}

/** Move a shape by delta in z-order (+1 = later = on top). */
export function reorderShape(doc: FlatlandDoc, id: string, delta: number): FlatlandDoc {
  const idx = doc.shapes.findIndex((s) => s.id === id);
  if (idx < 0) return doc;
  const to = Math.min(doc.shapes.length - 1, Math.max(0, idx + delta));
  if (to === idx) return doc;
  const shapes = [...doc.shapes];
  const [moved] = shapes.splice(idx, 1);
  shapes.splice(to, 0, moved!);
  return { ...doc, shapes };
}

export function duplicateShape(doc: FlatlandDoc, id: string): FlatlandDoc {
  const src = doc.shapes.find((s) => s.id === id);
  if (!src) return doc;
  const copy: ShapeInstance = structuredClone(src);
  copy.id = crypto.randomUUID();
  copy.transform.pos = v2(src.transform.pos.x + 5, src.transform.pos.y + 5);
  return { ...doc, shapes: [...doc.shapes, copy] };
}
