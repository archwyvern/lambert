import { expect, test } from "vitest";
import { ObjectTypeId } from "../../src/field/objectTypeIds";
import "../../src/field/objects";
import { addObject } from "../../src/document/docOps";
import { emptyDoc } from "../../src/document/schema";
import { buildSessionJson, parseSessionJson, TabSession } from "../../src/document/session";
import type { ObjectInstance } from "../../src/field/types";
import { Vector3 } from "@carapace/primitives";
import { v2 } from "../../src/field/vec";

const view = {
  mode: "lit" as const,
  opacity: 1,
  lightDir: [-0.5, -0.5, 0.7] as [number, number, number],
};

function tab(id: string, docPath: string | null, dirty: boolean, selectedId: string | null = null): TabSession {
  return {
    id,
    docPath,
    dirty,
    doc: addObject(emptyDoc("file:///art/hull.df.png", 64, 64), ObjectTypeId.Sphere, v2(10, 10)),
    view,
    selectedId,
  };
}

test("workspace session round-trips project, tabs, active index, and hydrates docs", () => {
  const session = {
    projectPath: "/proj",
    activeIndex: 1,
    tabs: [tab("a", "/proj/a.lmb", false), tab("b", null, true)],
  };
  const s = parseSessionJson(buildSessionJson(session));
  expect(s.projectPath).toBe("/proj");
  expect(s.activeIndex).toBe(1);
  expect(s.tabs.length).toBe(2);
  expect(s.tabs[0]!.id).toBe("a");
  expect(s.tabs[1]!.docPath).toBe(null);
  expect(s.tabs[1]!.dirty).toBe(true);
  // objects hydrate back into Vector instances (have methods, not plain objects)
  expect((s.tabs[0]!.doc.layers[0] as ObjectInstance).transform.pos).toBeInstanceOf(Vector3);
});

test("session with no open project round-trips (empty tabs, no active)", () => {
  const s = parseSessionJson(buildSessionJson({ projectPath: null, activeIndex: -1, tabs: [] }));
  expect(s.projectPath).toBe(null);
  expect(s.activeIndex).toBe(-1);
  expect(s.tabs).toEqual([]);
});

test("migrates a legacy per-tab view: an unknown mode -> normal, stray 'raster' field ignored", () => {
  const legacy = JSON.parse(
    buildSessionJson({ projectPath: "/p", activeIndex: 0, tabs: [tab("/p/a.png", null, false)] }),
  );
  legacy.tabs[0].view.mode = "height"; // a mode that no longer exists
  legacy.tabs[0].view.raster = true; // saved before the vector/raster toggle was removed — must not break parse
  const s = parseSessionJson(JSON.stringify(legacy));
  expect(s.tabs[0]!.view.mode).toBe("normal");
  expect("raster" in s.tabs[0]!.view).toBe(false); // the removed field is stripped, not carried forward
});

test("persists per-tab selection + viewport, and defaults them for legacy sessions", () => {
  const withVp = { ...tab("/p/a.png", null, false, "object-1"), viewport: { zoom: 2, panX: 10, panY: -5 } };
  const s = parseSessionJson(buildSessionJson({ projectPath: "/p", activeIndex: 0, tabs: [withVp] }));
  expect(s.tabs[0]!.selectedId).toBe("object-1");
  expect(s.tabs[0]!.viewport).toEqual({ zoom: 2, panX: 10, panY: -5 });

  const legacy = JSON.parse(buildSessionJson({ projectPath: "/p", activeIndex: 0, tabs: [tab("/p/a.png", null, false)] }));
  delete legacy.tabs[0].selectedId; // saved before selection/viewport persistence existed
  delete legacy.tabs[0].viewport;
  const s2 = parseSessionJson(JSON.stringify(legacy));
  expect(s2.tabs[0]!.selectedId).toBe(null);
  expect(s2.tabs[0]!.viewport).toBeUndefined();
});

test("one corrupt tab is dropped + counted, the rest of the session survives", () => {
  const good = JSON.parse(
    buildSessionJson({ projectPath: "/p", activeIndex: 0, tabs: [tab("a", "/p/a.lmb", false), tab("b", "/p/b.lmb", false)] }),
  );
  good.tabs[0].doc.source.width = "not-a-number"; // corrupt just the first tab's doc
  const s = parseSessionJson(JSON.stringify(good));
  expect(s.droppedTabs).toBe(1);
  expect(s.tabs.map((t) => t.id)).toEqual(["b"]); // the healthy tab is kept
});

test("rejects garbage and wrong versions", () => {
  expect(() => parseSessionJson("not json")).toThrow();
  expect(() => parseSessionJson("{}")).toThrow();
  const valid = JSON.parse(buildSessionJson({ projectPath: null, activeIndex: -1, tabs: [] }));
  valid.version = 2;
  expect(() => parseSessionJson(JSON.stringify(valid))).toThrow();
});
