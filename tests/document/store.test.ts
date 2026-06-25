import { expect, test } from "vitest";
import { ObjectTypeId } from "../../src/field/objectTypeIds";
import "../../src/field/objects";
import { emptyDoc, parseDoc, serializeDoc } from "../../src/document/schema";
import { addObject, duplicateObject, moveObjectTo, removeObject, reorderObject, updateObject } from "../../src/document/docOps";
import { DocumentStore } from "../../src/document/store";
import type { ObjectInstance } from "../../src/field/types";
import { v2 } from "../../src/field/vec";

const mkStore = () => new DocumentStore(emptyDoc("hull.df.png", 128, 128), null);
const object = (d: { layers: unknown[] }, i: number): ObjectInstance => d.layers[i] as ObjectInstance;

test("addObject appends, updateObject patches immutably", () => {
  const doc = emptyDoc("hull.df.png", 128, 128);
  const d1 = addObject(doc, ObjectTypeId.Sphere, v2(10, 10));
  expect(d1.layers.length).toBe(1);
  expect(doc.layers.length).toBe(0); // original untouched
  const id = d1.layers[0]!.id;
  const d2 = updateObject(d1, id, (s) => ({ ...s, transform: { ...s.transform, scale: s.transform.scale.withZ(0.5) } }));
  expect(object(d2, 0).transform.scale.z).toBe(0.5);
  expect(object(d1, 0).transform.scale.z).toBe(1);
});

test("removeObject, duplicateObject (identical copy), reorderObject", () => {
  let doc = addObject(addObject(emptyDoc("x.png", 64, 64), ObjectTypeId.Sphere, v2(0, 0)), ObjectTypeId.Pipe, v2(5, 5));
  const [a, b] = [doc.layers[0]!.id, doc.layers[1]!.id];
  doc = reorderObject(doc, a!, +1);
  expect(doc.layers.map((s) => s.id)).toEqual([b, a]);
  const srcPos = (doc.layers.find((s) => s.id === a) as ObjectInstance).transform.pos;
  const dup = duplicateObject(doc, a!);
  expect(dup.layers.length).toBe(3);
  // the copy is inserted right after the original, with an identical (un-offset) position
  expect(dup.layers[2]!.id).not.toBe(a);
  expect(object(dup, 2).transform.pos).toEqual({ x: srcPos.x, y: srcPos.y, z: srcPos.z });
  expect(removeObject(doc, a!).layers.map((s) => s.id)).toEqual([b]);
});

test("moveObjectTo: final-index semantics for drag reorder", () => {
  let doc = emptyDoc("x.png", 64, 64);
  doc = addObject(doc, ObjectTypeId.Sphere, v2(0, 0));
  doc = addObject(doc, ObjectTypeId.Pipe, v2(0, 0));
  doc = addObject(doc, ObjectTypeId.PipeVector, v2(0, 0));
  const [a, b, c] = doc.layers.map((s) => s.id);
  expect(moveObjectTo(doc, a!, 2).layers.map((s) => s.id)).toEqual([b, c, a]);
  expect(moveObjectTo(doc, c!, 0).layers.map((s) => s.id)).toEqual([c, a, b]);
  expect(moveObjectTo(doc, b!, 1).layers.map((s) => s.id)).toEqual([a, b, c]); // no-op
  expect(moveObjectTo(doc, "ghost", 0)).toBe(doc);
});

test("schema: optional object name round-trips", () => {
  const doc = addObject(emptyDoc("x.png", 64, 64), ObjectTypeId.Sphere, v2(0, 0));
  doc.layers[0]!.name = "boss stud";
  const back = parseDoc(serializeDoc(doc));
  expect(back.layers[0]!.name).toBe("boss stud");
});

test("store: update pushes undo, redo clears on new edit", () => {
  const store = mkStore();
  store.update((d) => addObject(d, ObjectTypeId.Sphere, v2(1, 1)));
  store.update((d) => addObject(d, ObjectTypeId.Pipe, v2(2, 2)));
  expect(store.state.doc.layers.length).toBe(2);
  store.undo();
  expect(store.state.doc.layers.length).toBe(1);
  store.redo();
  expect(store.state.doc.layers.length).toBe(2);
  store.undo();
  store.update((d) => addObject(d, ObjectTypeId.PipeVector, v2(3, 3)));
  expect(store.canRedo).toBe(false);
});

test("store: coalesced gesture is one undo step", () => {
  const store = mkStore();
  store.update((d) => addObject(d, ObjectTypeId.Sphere, v2(0, 0)));
  store.endGesture();
  const id = store.state.doc.layers[0]!.id;
  for (const x of [1, 2, 3, 4]) {
    store.update(
      (d) => updateObject(d, id, (s) => ({ ...s, transform: { ...s.transform, pos: s.transform.pos.withX(x).withY(0) } })),
      { coalesce: `move:${id}` },
    );
  }
  store.endGesture();
  expect(object(store.state.doc, 0).transform.pos.x).toBe(4);
  store.undo();
  expect(object(store.state.doc, 0).transform.pos.x).toBe(0); // whole drag undone at once
});

test("store: selection, dirty, markSaved, subscribe", () => {
  const store = mkStore();
  let notified = 0;
  const unsub = store.subscribe(() => notified++);
  store.update((d) => addObject(d, ObjectTypeId.Sphere, v2(0, 0)));
  expect(store.state.dirty).toBe(true);
  const id = store.state.doc.layers[0]!.id;
  store.select(id);
  expect(store.state.selectedId).toBe(id);
  store.markSaved("/tmp/x.lambert");
  expect(store.state.dirty).toBe(false);
  expect(store.state.docPath).toBe("/tmp/x.lambert");
  expect(notified).toBeGreaterThanOrEqual(3);
  unsub();
});

test("store: deleting the selected object deselects", () => {
  const store = mkStore();
  store.update((d) => addObject(d, ObjectTypeId.Sphere, v2(0, 0)));
  const id = store.state.doc.layers[0]!.id;
  store.select(id);
  store.update((d) => removeObject(d, id));
  expect(store.state.selectedId).toBe(null);
});

test("store: reset clears history and selection", () => {
  const store = mkStore();
  store.update((d) => addObject(d, ObjectTypeId.Sphere, v2(0, 0)));
  store.reset(emptyDoc("other.png", 32, 32), "/p/other.lambert");
  expect(store.canUndo).toBe(false);
  expect(store.state.docPath).toBe("/p/other.lambert");
  expect(store.state.dirty).toBe(false);
});

test("store: reset can restore a dirty session", () => {
  const store = mkStore();
  store.reset(emptyDoc("other.png", 32, 32), null, { dirty: true });
  expect(store.state.dirty).toBe(true);
});
