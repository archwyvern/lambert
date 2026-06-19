import { expect, test } from "vitest";
import "../../src/field/shapes";
import { addShape } from "../../src/document/docOps";
import { emptyDoc } from "../../src/document/schema";
import { buildSessionJson, parseSessionJson, TabSession } from "../../src/document/session";
import { Vector3 } from "@carapace/primitives";
import { v2 } from "../../src/field/vec";

const view = {
  mode: "lit" as const,
  opacity: 1,
  lightDir: [-0.5, -0.5, 0.7] as [number, number, number],
  raster: false,
};

function tab(imagePath: string, docPath: string | null, dirty: boolean): TabSession {
  return { imagePath, docPath, dirty, doc: addShape(emptyDoc("hull.png", 64, 64), "dome", v2(10, 10)), view };
}

test("workspace session round-trips project, tabs, active index, and hydrates docs", () => {
  const session = {
    projectPath: "/proj",
    activeIndex: 1,
    tabs: [tab("/proj/a.png", "/proj/a.lnb", false), tab("/proj/b.png", null, true)],
  };
  const s = parseSessionJson(buildSessionJson(session));
  expect(s.projectPath).toBe("/proj");
  expect(s.activeIndex).toBe(1);
  expect(s.tabs.length).toBe(2);
  expect(s.tabs[1]!.docPath).toBe(null);
  expect(s.tabs[1]!.dirty).toBe(true);
  // shapes hydrate back into Vector instances (have methods, not plain objects)
  expect(s.tabs[0]!.doc.shapes[0]!.transform.pos).toBeInstanceOf(Vector3);
});

test("session with no open project round-trips (empty tabs, no active)", () => {
  const s = parseSessionJson(buildSessionJson({ projectPath: null, activeIndex: -1, tabs: [] }));
  expect(s.projectPath).toBe(null);
  expect(s.activeIndex).toBe(-1);
  expect(s.tabs).toEqual([]);
});

test("migrates a legacy per-tab view: removed 'height' mode -> lit, missing raster -> false", () => {
  const legacy = JSON.parse(
    buildSessionJson({ projectPath: "/p", activeIndex: 0, tabs: [tab("/p/a.png", null, false)] }),
  );
  legacy.tabs[0].view.mode = "height"; // a mode that no longer exists
  delete legacy.tabs[0].view.raster; // saved before the raster toggle existed
  const s = parseSessionJson(JSON.stringify(legacy));
  expect(s.tabs[0]!.view.mode).toBe("lit");
  expect(s.tabs[0]!.view.raster).toBe(false);
});

test("rejects garbage and wrong versions", () => {
  expect(() => parseSessionJson("not json")).toThrow();
  expect(() => parseSessionJson("{}")).toThrow();
  const valid = JSON.parse(buildSessionJson({ projectPath: null, activeIndex: -1, tabs: [] }));
  valid.version = 2;
  expect(() => parseSessionJson(JSON.stringify(valid))).toThrow();
});
