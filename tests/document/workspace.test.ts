import { expect, test } from "vitest";
import { DocumentStore } from "../../src/document/store";
import { emptyDoc, emptyProjectConfig } from "../../src/document/schema";
import { legacySidecarCandidates, sidecarPath, Tab, Workspace } from "../../src/document/workspace";

function tab(imagePath: string): Tab {
  return {
    imagePath,
    docPath: null,
    store: new DocumentStore(emptyDoc("x.png", 8, 8), null),
    diffuse: { bytes: new Uint8Array(0), dir: "/p" },
  };
}

function ws(): Workspace {
  return new Workspace("/p", emptyProjectConfig());
}

test("sidecarPath / legacy candidates drop the image suffix", () => {
  expect(sidecarPath("/p/ship.png")).toBe("/p/ship.lnb");
  expect(sidecarPath("/p/ship.df.png")).toBe("/p/ship.lnb");
  expect(legacySidecarCandidates("/p/ship.png")).toEqual(["/p/ship.lnb", "/p/ship.lambert", "/p/ship.flatland"]);
});

test("openTab pushes and activates; reopening the same image focuses, no duplicate", () => {
  const w = ws();
  w.openTab(tab("/p/a.png"));
  w.openTab(tab("/p/b.png"));
  expect(w.tabs.length).toBe(2);
  expect(w.activeIndex).toBe(1);
  w.openTab(tab("/p/a.png")); // same image again
  expect(w.tabs.length).toBe(2);
  expect(w.activeIndex).toBe(0); // focused, not duplicated
});

test("focus selects an open tab", () => {
  const w = ws();
  w.openTab(tab("/p/a.png"));
  w.openTab(tab("/p/b.png"));
  w.focus("/p/a.png");
  expect(w.active?.imagePath).toBe("/p/a.png");
});

test("closeTab adjusts activeIndex", () => {
  const make = (): Workspace => {
    const w = ws();
    w.openTab(tab("/p/a.png"));
    w.openTab(tab("/p/b.png"));
    w.openTab(tab("/p/c.png"));
    return w;
  };
  // active = B (1); close A (before active) -> active shifts to still point at B
  let w = make();
  w.activeIndex = 1;
  w.closeTab("/p/a.png");
  expect(w.active?.imagePath).toBe("/p/b.png");
  // active = B (1); close B (the active) -> the tab that slid into slot 1 (C) becomes active
  w = make();
  w.activeIndex = 1;
  w.closeTab("/p/b.png");
  expect(w.active?.imagePath).toBe("/p/c.png");
  // active = B (1); close C (after active) -> active unchanged
  w = make();
  w.activeIndex = 1;
  w.closeTab("/p/c.png");
  expect(w.active?.imagePath).toBe("/p/b.png");
  // close the last remaining tab -> no active
  const solo = ws();
  solo.openTab(tab("/p/only.png"));
  solo.closeTab("/p/only.png");
  expect(w.tabs.length).toBeGreaterThan(0); // sanity: previous w untouched
  expect(solo.activeIndex).toBe(-1);
  expect(solo.active).toBe(null);
});

test("subscribe fires on structural changes", () => {
  const w = ws();
  let hits = 0;
  const unsub = w.subscribe(() => (hits += 1));
  w.openTab(tab("/p/a.png"));
  w.openTab(tab("/p/b.png"));
  w.focus("/p/a.png");
  w.closeTab("/p/a.png");
  unsub();
  w.openTab(tab("/p/c.png")); // after unsub: no further hits
  expect(hits).toBe(4);
});
