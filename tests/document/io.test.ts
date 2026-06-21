import { expect, test } from "vitest";
import { encode } from "fast-png";
import "../../src/field/shapes";
import { basename, dirname, joinPath } from "../../src/document/paths";
import { buildNxExport } from "../../src/document/exports";
import { DEFAULT_NORMAL_DIRS, emptyDoc, serializeDoc } from "../../src/document/schema";
import { addShape } from "../../src/document/docOps";
import { flattenLayers } from "../../src/field/flatten";
import { renderField } from "../../src/field/render";
import { hasSidecar, openImageTab, saveTab } from "../../src/document/io";
import { sidecarPath } from "../../src/document/workspace";
import type { Host } from "../../src/ui/host";
import { v2 } from "../../src/field/vec";

test("posix path helpers", () => {
  expect(dirname("/a/b/c.png")).toBe("/a/b");
  expect(basename("/a/b/c.png")).toBe("c.png");
  expect(joinPath("/a/b", "c.png")).toBe("/a/b/c.png");
  expect(joinPath("/a/b", "../c.png")).toBe("/a/c.png");
});

const gray = (w: number, h: number) => encode({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(128) });

function fakeHost(files: Record<string, Uint8Array>): Host {
  return {
    openDialog: () => Promise.resolve(null),
    saveDialog: () => Promise.resolve(null),
    openFolderDialog: () => Promise.resolve(null),
    readFile: (p) => {
      const f = files[p];
      return f ? Promise.resolve(f) : Promise.reject(new Error(`ENOENT ${p}`));
    },
    writeFile: (p, d) => {
      files[p] = d;
      return Promise.resolve();
    },
    pathExists: (p) => Promise.resolve(p in files),
    loadSession: () => Promise.resolve(null),
    saveSession: () => Promise.resolve(),
    onMenuAction: () => {},
    guardClose: () => {},
    onConfirmClose: () => {},
    respondClose: () => {},
  };
}

test("openImageTab on an image without a sidecar yields an empty doc and null docPath", async () => {
  const files = { "/p/ship.png": gray(32, 16) };
  const tab = await openImageTab(fakeHost(files), "/p/ship.png");
  expect(tab.docPath).toBe(null);
  expect(tab.store.state.doc.layers.length).toBe(0);
  expect(tab.store.state.doc.source).toEqual({ path: "ship.png", width: 32, height: 16 });
  expect(tab.diffuse.dir).toBe("/p");
});

test("openImageTab loads an existing .lnb sidecar", async () => {
  const doc = emptyDoc("ship.png", 32, 16);
  const files = {
    "/p/ship.png": gray(32, 16),
    "/p/ship.lnb": new TextEncoder().encode(serializeDoc(doc)),
  };
  const tab = await openImageTab(fakeHost(files), "/p/ship.png");
  expect(tab.docPath).toBe("/p/ship.lnb");
  expect(tab.store.state.doc.source.width).toBe(32);
});

test("openImageTab rejects on dimension mismatch (NX contract)", async () => {
  const doc = emptyDoc("ship.png", 64, 64);
  const files = {
    "/p/ship.png": gray(32, 32),
    "/p/ship.lnb": new TextEncoder().encode(serializeDoc(doc)),
  };
  await expect(openImageTab(fakeHost(files), "/p/ship.png")).rejects.toThrow(/64x64/);
});

test("saveTab writes a .lnb, migrating a legacy .lambert sidecar", async () => {
  const doc = emptyDoc("ship.png", 8, 8);
  const files: Record<string, Uint8Array> = {
    "/p/ship.png": gray(8, 8),
    "/p/ship.lambert": new TextEncoder().encode(serializeDoc(doc)), // legacy sidecar
  };
  const host = fakeHost(files);
  const tab = await openImageTab(host, "/p/ship.png");
  expect(tab.docPath).toBe("/p/ship.lambert"); // resolved the legacy one
  const written = await saveTab(host, tab);
  expect(written).toBe("/p/ship.lnb");
  expect("/p/ship.lnb" in files).toBe(true);
  expect(tab.docPath).toBe("/p/ship.lnb");
  expect(sidecarPath("/p/ship.png")).toBe("/p/ship.lnb");
});

test("hasSidecar reflects whether any sidecar exists", async () => {
  const files = { "/p/a.png": gray(4, 4), "/p/b.png": gray(4, 4), "/p/b.lnb": new Uint8Array([1]) };
  const host = fakeHost(files);
  expect(await hasSidecar(host, "/p/a.png")).toBe(false);
  expect(await hasSidecar(host, "/p/b.png")).toBe(true);
});

test("buildNxExport: nx bytes + sibling path + empty-mask warning", () => {
  let doc = emptyDoc("hull.df.png", 32, 32);
  const empty = buildNxExport(doc, renderField(flattenLayers(doc.layers), 32, 32, { supersample: 1 }), "/p/hull.df.png", DEFAULT_NORMAL_DIRS);
  expect(empty.path).toBe("/p/hull.nx.png");
  expect(empty.warning).toMatch(/empty/);
  doc = addShape(doc, "dome", v2(16, 16));
  const real = buildNxExport(doc, renderField(flattenLayers(doc.layers), 32, 32, { supersample: 1 }), "/p/hull.df.png", DEFAULT_NORMAL_DIRS);
  expect(real.warning).toBe(null);
  expect(real.bytes.length).toBeGreaterThan(0);
});
