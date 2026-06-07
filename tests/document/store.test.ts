import { expect, test } from "vitest";
import "../../src/field/shapes";
import { emptyDoc, parseDoc, serializeDoc } from "../../src/document/schema";
import { addShape, duplicateShape, moveShapeTo, removeShape, reorderShape, updateShape } from "../../src/document/docOps";
import { DocumentStore } from "../../src/document/store";
import { v2 } from "../../src/field/vec";

const mkStore = () => new DocumentStore(emptyDoc("hull.df.png", 128, 128), null);

test("addShape appends, updateShape patches immutably", () => {
  const doc = emptyDoc("hull.df.png", 128, 128);
  const d1 = addShape(doc, "dome", v2(10, 10));
  expect(d1.shapes.length).toBe(1);
  expect(doc.shapes.length).toBe(0); // original untouched
  const id = d1.shapes[0]!.id;
  const d2 = updateShape(d1, id, (s) => ({ ...s, transform: { ...s.transform, scale: { ...s.transform.scale, z: 0.5 } } }));
  expect(d2.shapes[0]!.transform.scale.z).toBe(0.5);
  expect(d1.shapes[0]!.transform.scale.z).toBe(1);
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

test("moveShapeTo: final-index semantics for drag reorder", () => {
  let doc = emptyDoc("x.png", 64, 64);
  doc = addShape(doc, "dome", v2(0, 0));
  doc = addShape(doc, "ridge", v2(0, 0));
  doc = addShape(doc, "groove", v2(0, 0));
  const [a, b, c] = doc.shapes.map((s) => s.id);
  expect(moveShapeTo(doc, a!, 2).shapes.map((s) => s.id)).toEqual([b, c, a]);
  expect(moveShapeTo(doc, c!, 0).shapes.map((s) => s.id)).toEqual([c, a, b]);
  expect(moveShapeTo(doc, b!, 1).shapes.map((s) => s.id)).toEqual([a, b, c]); // no-op
  expect(moveShapeTo(doc, "ghost", 0)).toBe(doc);
});

test("schema: legacy 'raise' op migrates to 'max' on load", () => {
  const doc = addShape(emptyDoc("x.png", 64, 64), "dome", v2(0, 0));
  const raw = JSON.parse(serializeDoc(doc));
  raw.shapes[0].combine.op = "raise";
  const back = parseDoc(JSON.stringify(raw));
  expect(back.shapes[0]!.combine.op).toBe("max");
});

test("schema: optional shape name round-trips", () => {
  const doc = addShape(emptyDoc("x.png", 64, 64), "dome", v2(0, 0));
  doc.shapes[0]!.name = "boss stud";
  const back = parseDoc(serializeDoc(doc));
  expect(back.shapes[0]!.name).toBe("boss stud");
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

test("store: reset can restore a dirty session", () => {
  const store = mkStore();
  store.reset(emptyDoc("other.png", 32, 32), null, { dirty: true });
  expect(store.state.dirty).toBe(true);
});
