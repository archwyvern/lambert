import { expect, test } from "vitest";
import { DocumentStore } from "../../src/document/store";
import { emptyDoc, emptyProjectConfig } from "../../src/document/schema";
import { Tab, Workspace } from "../../src/document/workspace";

let n = 0;
function tab(opts?: { id?: string; docPath?: string | null }): Tab {
  const docPath = opts?.docPath ?? null;
  return {
    id: opts?.id ?? `t${n++}`,
    docPath,
    store: new DocumentStore(emptyDoc("file:///p/x.df.png", 8, 8), docPath),
    diffuse: { bytes: new Uint8Array(0) },
  };
}

function ws(): Workspace {
  return new Workspace("/p", emptyProjectConfig());
}

test("untitled tabs never dedup; openTab activates the newest", () => {
  const w = ws();
  w.openTab(tab()); // untitled (docPath null)
  w.openTab(tab()); // untitled
  expect(w.tabs.length).toBe(2);
  expect(w.activeIndex).toBe(1);
});

test("reopening a tab with the same docPath focuses, no duplicate", () => {
  const w = ws();
  w.openTab(tab({ id: "a", docPath: "/p/a.lmb" }));
  w.openTab(tab({ id: "b", docPath: "/p/b.lmb" }));
  expect(w.tabs.length).toBe(2);
  expect(w.activeIndex).toBe(1);
  w.openTab(tab({ id: "a2", docPath: "/p/a.lmb" })); // same doc again
  expect(w.tabs.length).toBe(2);
  expect(w.active?.docPath).toBe("/p/a.lmb");
  expect(w.activeIndex).toBe(0); // focused, not duplicated
});

test("focus selects an open tab by id", () => {
  const w = ws();
  w.openTab(tab({ id: "a" }));
  w.openTab(tab({ id: "b" }));
  w.focus("a");
  expect(w.active?.id).toBe("a");
});

test("closeTab(id) adjusts activeIndex", () => {
  const make = (): Workspace => {
    const w = ws();
    w.openTab(tab({ id: "a" }));
    w.openTab(tab({ id: "b" }));
    w.openTab(tab({ id: "c" }));
    return w;
  };
  let w = make();
  w.activeIndex = 1;
  w.closeTab("a"); // before active -> active still points at B
  expect(w.active?.id).toBe("b");
  w = make();
  w.activeIndex = 1;
  w.closeTab("b"); // the active -> C slides into slot 1
  expect(w.active?.id).toBe("c");
  w = make();
  w.activeIndex = 1;
  w.closeTab("c"); // after active -> unchanged
  expect(w.active?.id).toBe("b");
  const solo = ws();
  solo.openTab(tab({ id: "only" }));
  solo.closeTab("only");
  expect(solo.activeIndex).toBe(-1);
  expect(solo.active).toBe(null);
});

test("subscribe fires on structural changes and on notify()", () => {
  const w = ws();
  let hits = 0;
  const unsub = w.subscribe(() => (hits += 1));
  w.openTab(tab({ id: "a" }));
  w.openTab(tab({ id: "b" }));
  w.focus("a");
  w.closeTab("a");
  w.notify();
  unsub();
  w.openTab(tab({ id: "c" })); // after unsub: no further hits
  expect(hits).toBe(5);
});

test("moveTab reorders by insertion slot and keeps the active tab active", () => {
  const w = ws();
  w.openTab(tab({ id: "a" }));
  w.openTab(tab({ id: "b" }));
  w.openTab(tab({ id: "c" }));
  w.focus("b");
  w.moveTab("a", 3); // move A to the end (slot after C)
  expect(w.tabs.map((t) => t.id)).toEqual(["b", "c", "a"]);
  expect(w.active?.id).toBe("b"); // active follows the reorder
  w.moveTab("a", 0); // back to the front
  expect(w.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
  expect(w.active?.id).toBe("b");
  let hits = 0;
  const unsub = w.subscribe(() => (hits += 1));
  w.moveTab("a", 1); // dropping in its own slot is a no-op (slot 1 = right of itself)
  expect(w.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
  expect(hits).toBe(0); // no phantom emit -> no session stash churn
  unsub();
});
