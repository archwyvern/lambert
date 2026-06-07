import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import { emptyDoc, parseDoc, serializeDoc } from "../../src/document/schema";
import { v2 } from "../../src/field/vec";

test("empty doc round-trips", () => {
  const doc = emptyDoc("hull.df.png", 256, 128);
  const back = parseDoc(serializeDoc(doc));
  expect(back).toEqual(doc);
});

test("doc with shapes round-trips", () => {
  const doc = emptyDoc("hull.df.png", 256, 128);
  doc.shapes.push(createShapeInstance("dome", v2(64, 64)));
  doc.shapes.push(createShapeInstance("groove", v2(80, 40)));
  const back = parseDoc(serializeDoc(doc));
  expect(back).toEqual(doc);
});

test("rejects wrong schema version", () => {
  const doc = emptyDoc("hull.df.png", 256, 128) as unknown as Record<string, unknown>;
  doc.schemaVersion = 2;
  expect(() => parseDoc(JSON.stringify(doc))).toThrow();
});

test("rejects malformed documents", () => {
  expect(() => parseDoc("{}")).toThrow();
  expect(() => parseDoc("not json")).toThrow();
  const bad = emptyDoc("hull.df.png", 0, 128); // zero dims
  expect(() => parseDoc(serializeDoc(bad))).toThrow();
});
