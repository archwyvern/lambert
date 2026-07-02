import { expect, test } from "vitest";
import "../../src/field/objects";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import {
  emptyDoc,
  emptyProjectConfig,
  hydrateObjectRaw,
  parseDoc,
  parseProjectConfig,
  presetLibrarySchema,
  serializeDoc,
  serializeProjectConfig,
} from "../../src/document/schema";
import { v2 } from "../../src/field/vec";

test("project config round-trips with default normal dirs", () => {
  const config = emptyProjectConfig();
  expect(config).toEqual({ schemaVersion: 1, normalDirs: { red: "right", green: "up" } });
  expect(parseProjectConfig(serializeProjectConfig(config))).toEqual(config);
});

test("project config applies normalDirs defaults when absent", () => {
  expect(parseProjectConfig(JSON.stringify({ schemaVersion: 1 }))).toEqual(emptyProjectConfig());
});

test("default normalDirs are independent per parse (no shared-constant mutation hazard)", () => {
  const a = parseProjectConfig(JSON.stringify({ schemaVersion: 1 }));
  const b = parseProjectConfig(JSON.stringify({ schemaVersion: 1 }));
  expect(a.normalDirs).not.toBe(b.normalDirs); // distinct objects, not the module constant
  a.normalDirs.red = "left"; // mutating one must not bleed into the next parse
  expect(parseProjectConfig(JSON.stringify({ schemaVersion: 1 })).normalDirs.red).toBe("right");
});

test("a newer-than-supported schemaVersion throws a friendly forward-compat message", () => {
  expect(() => parseProjectConfig(JSON.stringify({ schemaVersion: 2 }))).toThrow(/newer version of Lambert/);
  const doc = emptyDoc("hull.df.png", 8, 8);
  const future = { ...(doc as Record<string, unknown>), schemaVersion: 99 };
  expect(() => parseDoc(JSON.stringify(future))).toThrow(/newer version of Lambert/);
});

test("doc no longer carries normalDirs; a legacy normalDirs field is dropped on load", () => {
  const doc = emptyDoc("hull.df.png", 64, 64);
  expect("normalDirs" in doc).toBe(false);
  const legacy = { ...(doc as Record<string, unknown>), normalDirs: { red: "left", green: "down" } };
  const back = parseDoc(JSON.stringify(legacy));
  expect("normalDirs" in back).toBe(false);
});

test("source is referenced by uri and round-trips", () => {
  const doc = emptyDoc("file:///art/6powercoil.df.png", 64, 64);
  expect(doc.source.uri).toBe("file:///art/6powercoil.df.png");
  const back = parseDoc(serializeDoc(doc));
  expect(back.source.uri).toBe("file:///art/6powercoil.df.png");
});

test("empty doc round-trips", () => {
  const doc = emptyDoc("hull.df.png", 256, 128);
  const back = parseDoc(serializeDoc(doc));
  expect(back).toEqual(doc);
});

test("doc with objects round-trips", () => {
  const doc = emptyDoc("hull.df.png", 256, 128);
  doc.layers.push(createObjectInstance(ObjectTypeId.Sphere, v2(64, 64)));
  doc.layers.push(createObjectInstance(ObjectTypeId.PipeVector, v2(80, 40)));
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

test("saved presets round-trip through project.lambert and rehydrate to live instances", () => {
  const template = createObjectInstance(ObjectTypeId.Sphere, v2(10, 20));
  template.params.profile = "smooth";
  template.opacity = 0.5;
  const config = {
    ...emptyProjectConfig(),
    presets: [{ id: "p1", name: "Soft Bump", object: JSON.parse(JSON.stringify(template)) }],
  };
  const back = parseProjectConfig(serializeProjectConfig(config));
  expect(back.presets?.length).toBe(1);
  expect(back.presets![0]!.name).toBe("Soft Bump");
  // rehydrate the template (the palette instantiation path): vectors become live Vector2/3 again
  const revived = hydrateObjectRaw(JSON.parse(JSON.stringify(back.presets![0]!.object)));
  expect(revived.params.profile).toBe("smooth");
  expect(revived.opacity).toBe(0.5);
  expect(revived.transform.pos.withX(0).x).toBe(0); // live Vector3 (method works)
});

test("preset library envelope validates and rejects junk", () => {
  const template = createObjectInstance(ObjectTypeId.Sphere, v2(0, 0));
  const lib = { schemaVersion: 1, presets: [{ id: "x", name: "A", object: JSON.parse(JSON.stringify(template)) }] };
  expect(presetLibrarySchema.parse(JSON.parse(JSON.stringify(lib))).presets.length).toBe(1);
  expect(() => presetLibrarySchema.parse({ schemaVersion: 1, presets: [{ id: "x" }] })).toThrow();
  expect(() => presetLibrarySchema.parse({ presets: [] })).toThrow(); // missing version
});
