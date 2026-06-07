import { expect, test } from "vitest";
import { encode } from "fast-png";
import "../../src/field/shapes";
import { basename, dirname, joinPath } from "../../src/document/paths";
import { buildNxExport } from "../../src/document/exports";
import { emptyDoc, serializeDoc } from "../../src/document/schema";
import { addShape } from "../../src/document/docOps";
import { renderField } from "../../src/field/render";
import { loadProject } from "../../src/document/io";
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
    readFile: (p) => {
      const f = files[p];
      return f ? Promise.resolve(f) : Promise.reject(new Error(`ENOENT ${p}`));
    },
    writeFile: (p, d) => {
      files[p] = d;
      return Promise.resolve();
    },
    loadSession: () => Promise.resolve(null),
    saveSession: () => Promise.resolve(),
    guardClose: () => {},
    onConfirmClose: () => {},
    respondClose: () => {},
  };
}

test("loadProject resolves the diffuse relative to the doc and checks dims", async () => {
  const doc = emptyDoc("hull.df.png", 32, 16);
  const files: Record<string, Uint8Array> = {
    "/proj/hull.flatland": new TextEncoder().encode(serializeDoc(doc)),
    "/proj/hull.df.png": gray(32, 16),
  };
  const loaded = await loadProject(fakeHost(files), "/proj/hull.flatland");
  expect(loaded.doc.source.width).toBe(32);
  expect(loaded.diffuseBytes.length).toBeGreaterThan(0);
  expect(loaded.diffuseDir).toBe("/proj");
});

test("loadProject rejects on dimension mismatch (NX contract)", async () => {
  const doc = emptyDoc("hull.df.png", 64, 64);
  const files = {
    "/p/hull.flatland": new TextEncoder().encode(serializeDoc(doc)),
    "/p/hull.df.png": gray(32, 32),
  };
  await expect(loadProject(fakeHost(files), "/p/hull.flatland")).rejects.toThrow(/64x64/);
});

test("buildNxExport: nx bytes + sibling path + empty-mask warning", () => {
  let doc = emptyDoc("hull.df.png", 32, 32);
  const empty = buildNxExport(doc, renderField(doc.shapes, 32, 32, { supersample: 1 }), "/p/hull.df.png");
  expect(empty.path).toBe("/p/hull.nx.png");
  expect(empty.warning).toMatch(/empty/);
  doc = addShape(doc, "dome", v2(16, 16));
  const real = buildNxExport(doc, renderField(doc.shapes, 32, 32, { supersample: 1 }), "/p/hull.df.png");
  expect(real.warning).toBe(null);
  expect(real.bytes.length).toBeGreaterThan(0);
});
