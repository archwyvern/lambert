import { expect, test } from "vitest";
import "../../src/field/shapes";
import { addShape } from "../../src/document/docOps";
import { emptyDoc } from "../../src/document/schema";
import { buildSessionJson, parseSessionJson } from "../../src/document/session";
import { v2 } from "../../src/field/vec";

const view = { mode: "lit" as const, opacity: 1, lightDir: [-0.5, -0.5, 0.7] as [number, number, number] };

test("session round-trips doc, paths, dirty flag, and view state", () => {
  const doc = addShape(emptyDoc("hull.df.png", 64, 64), "dome", v2(10, 10));
  const json = buildSessionJson({
    doc,
    docPath: "/p/hull.flatland",
    diffusePath: "/p/hull.df.png",
    dirty: true,
    view,
  });
  const s = parseSessionJson(json);
  expect(s.doc).toEqual(doc);
  expect(s.docPath).toBe("/p/hull.flatland");
  expect(s.diffusePath).toBe("/p/hull.df.png");
  expect(s.dirty).toBe(true);
  expect(s.view.mode).toBe("lit");
});

test("session tolerates a never-saved doc (null docPath)", () => {
  const doc = emptyDoc("hull.png", 32, 32);
  const s = parseSessionJson(
    buildSessionJson({ doc, docPath: null, diffusePath: "/p/hull.png", dirty: true, view }),
  );
  expect(s.docPath).toBe(null);
});

test("rejects garbage and wrong versions", () => {
  expect(() => parseSessionJson("not json")).toThrow();
  expect(() => parseSessionJson("{}")).toThrow();
  const doc = emptyDoc("a.png", 8, 8);
  const valid = JSON.parse(buildSessionJson({ doc, docPath: null, diffusePath: "/a.png", dirty: false, view }));
  valid.version = 2;
  expect(() => parseSessionJson(JSON.stringify(valid))).toThrow();
});
