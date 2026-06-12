import type { LambertDoc } from "./schema";
import { createShapeInstance } from "../field/registry";
import type { ShapeInstance } from "../field/types";
import { Vec2, v2 } from "../field/vec";

export function addShape(doc: LambertDoc, typeId: string, pos: Vec2): LambertDoc {
  return { ...doc, shapes: [...doc.shapes, createShapeInstance(typeId, pos)] };
}

export function removeShape(doc: LambertDoc, id: string): LambertDoc {
  return { ...doc, shapes: doc.shapes.filter((s) => s.id !== id) };
}

export function updateShape(
  doc: LambertDoc,
  id: string,
  patch: (s: ShapeInstance) => ShapeInstance,
): LambertDoc {
  return { ...doc, shapes: doc.shapes.map((s) => (s.id === id ? patch(s) : s)) };
}

/** Move a shape by delta in z-order (+1 = later = on top). */
export function reorderShape(doc: LambertDoc, id: string, delta: number): LambertDoc {
  const idx = doc.shapes.findIndex((s) => s.id === id);
  if (idx < 0) return doc;
  const to = Math.min(doc.shapes.length - 1, Math.max(0, idx + delta));
  if (to === idx) return doc;
  const shapes = [...doc.shapes];
  const [moved] = shapes.splice(idx, 1);
  shapes.splice(to, 0, moved!);
  return { ...doc, shapes };
}

/** Move a shape to a final array index (drag-reorder semantics: remove, then insert). */
export function moveShapeTo(doc: LambertDoc, id: string, finalIndex: number): LambertDoc {
  const from = doc.shapes.findIndex((s) => s.id === id);
  if (from < 0) return doc;
  const to = Math.min(doc.shapes.length - 1, Math.max(0, finalIndex));
  if (to === from) return doc;
  const shapes = [...doc.shapes];
  const [moved] = shapes.splice(from, 1);
  shapes.splice(to, 0, moved!);
  return { ...doc, shapes };
}

export function duplicateShape(doc: LambertDoc, id: string): LambertDoc {
  const src = doc.shapes.find((s) => s.id === id);
  if (!src) return doc;
  const copy: ShapeInstance = structuredClone(src);
  copy.id = crypto.randomUUID();
  copy.transform.pos = { ...src.transform.pos, x: src.transform.pos.x + 5, y: src.transform.pos.y + 5 };
  return { ...doc, shapes: [...doc.shapes, copy] };
}
