import { expect, test } from "vitest";
import "../../src/field/shapes";
import { emptyDoc } from "../../src/document/schema";
import { addShape, duplicateShape, removeShape, reorderShape, updateShape } from "../../src/document/docOps";
import { DocumentStore } from "../../src/document/store";
import { v2 } from "../../src/field/vec";

const mkStore = () => new DocumentStore(emptyDoc("hull.df.png", 128, 128), null);

test("addShape appends, updateShape patches immutably", () => {
  const doc = emptyDoc("hull.df.png", 128, 128);
  const d1 = addShape(doc, "dome", v2(10, 10));
  expect(d1.shapes.length).toBe(1);
  expect(doc.shapes.length).toBe(0); // original untouched
  const id = d1.shapes[0]!.id;
  const d2 = updateShape(d1, id, (s) => ({ ...s, strength: 0.5 }));
  expect(d2.shapes[0]!.strength).toBe(0.5);
  expect(d1.shapes[0]!.strength).toBe(1);
});

test("removeShape, duplicateShape, reorderShape", () => {
  let doc = addShape(addShape(emptyDoc("x.png", 64, 64), "dome", v2(0, 0)), "ridge", v2(5, 5));
  const [a, b] = [doc.shapes[0]!.id, doc.shapes[1]!.id];
  doc = reorderShape(doc, a!, +1);
  expect(doc.shapes.map((s) => s.id)).toEqual([b, a]);
  const srcPos = doc.shapes.find((s) => s.id === a)!.transform.pos;
  const dup = duplicateShape(doc, a!);
  expect(dup.shapes.length).toBe(3);
  expect(dup.shapes[2]!.id).not.toBe(a);
  expect(dup.shapes[2]!.transform.pos).toEqual({ x: srcPos.x + 5, y: srcPos.y + 5 });
  expect(removeShape(doc, a!).shapes.map((s) => s.id)).toEqual([b]);
});

test("store: update pushes undo, redo clears on new edit", () => {
  const store = mkStore();
  store.update((d) => addShape(d, "dome", v2(1, 1)));
  store.update((d) => addShape(d, "ridge", v2(2, 2)));
  expect(store.state.doc.shapes.length).toBe(2);
  store.undo();
  expect(store.state.doc.shapes.length).toBe(1);
  store.redo();
  expect(store.state.doc.shapes.length).toBe(2);
  store.undo();
  store.update((d) => addShape(d, "groove", v2(3, 3)));
  expect(store.canRedo).toBe(false);
});

test("store: coalesced gesture is one undo step", () => {
  const store = mkStore();
  store.update((d) => addShape(d, "dome", v2(0, 0)));
  store.endGesture();
  const id = store.state.doc.shapes[0]!.id;
  for (const x of [1, 2, 3, 4]) {
    store.update(
      (d) => updateShape(d, id, (s) => ({ ...s, transform: { ...s.transform, pos: v2(x, 0) } })),
      { coalesce: `move:${id}` },
    );
  }
  store.endGesture();
  expect(store.state.doc.shapes[0]!.transform.pos.x).toBe(4);
  store.undo();
  expect(store.state.doc.shapes[0]!.transform.pos.x).toBe(0); // whole drag undone at once
});

test("store: selection, dirty, markSaved, subscribe", () => {
  const store = mkStore();
  let notified = 0;
  const unsub = store.subscribe(() => notified++);
  store.update((d) => addShape(d, "dome", v2(0, 0)));
  expect(store.state.dirty).toBe(true);
  const id = store.state.doc.shapes[0]!.id;
  store.select(id);
  expect(store.state.selectedId).toBe(id);
  store.markSaved("/tmp/x.flatland");
  expect(store.state.dirty).toBe(false);
  expect(store.state.docPath).toBe("/tmp/x.flatland");
  expect(notified).toBeGreaterThanOrEqual(3);
  unsub();
});

test("store: deleting the selected shape deselects", () => {
  const store = mkStore();
  store.update((d) => addShape(d, "dome", v2(0, 0)));
  const id = store.state.doc.shapes[0]!.id;
  store.select(id);
  store.update((d) => removeShape(d, id));
  expect(store.state.selectedId).toBe(null);
});

test("store: reset clears history and selection", () => {
  const store = mkStore();
  store.update((d) => addShape(d, "dome", v2(0, 0)));
  store.reset(emptyDoc("other.png", 32, 32), "/p/other.flatland");
  expect(store.canUndo).toBe(false);
  expect(store.state.docPath).toBe("/p/other.flatland");
  expect(store.state.dirty).toBe(false);
});
