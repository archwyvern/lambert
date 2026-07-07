import { expect, test } from "vitest";
import { ObjectTypeId } from "../../src/field/objectTypeIds";
import { encode } from "fast-png";
import "../../src/field/objects";
import { basename, dirname, joinPath } from "../../src/document/paths";
import { buildNxExport } from "../../src/document/exports";
import { DEFAULT_NORMAL_DIRS, DEFAULT_OUTPUT, emptyDoc, emptyProjectConfig, serializeDoc, serializeProjectConfig } from "../../src/document/schema";
import { addObject } from "../../src/document/docOps";
import { flattenLayers } from "../../src/field/flatten";
import { renderField } from "../../src/field/render";
import {
  exportTabNx,
  newProjectFlow,
  openDocTab,
  openProjectByPath,
  openProjectFlow,
  saveTab,
} from "../../src/document/io";
import { DocumentStore } from "../../src/document/store";
import { PROJECT_FILE, type Tab } from "../../src/document/workspace";
import type { Host } from "../../src/ui/host";
import { v2 } from "../../src/field/vec";

// An untitled tab (no docPath) built directly — exercises saveTab's save-as path.
const untitledTab = (uri: string, w: number, h: number, bytes: Uint8Array): Tab => ({
  id: "t1",
  docPath: null,
  store: new DocumentStore(emptyDoc(uri, w, h), null),
  diffuse: { bytes },
});

test("posix path helpers", () => {
  expect(dirname("/a/b/c.png")).toBe("/a/b");
  expect(basename("/a/b/c.png")).toBe("c.png");
  expect(joinPath("/a/b", "c.png")).toBe("/a/b/c.png");
  expect(joinPath("/a/b", "../c.png")).toBe("/a/c.png");
});

const gray = (w: number, h: number) => encode({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(128) });

// fakeHost: `files` is keyed by both filesystem paths (readFile) and full URLs (fetchUrl), so a test
// can stage either a local diffuse or a remote one.
function fakeHost(files: Record<string, Uint8Array>): Host {
  return {
    openDialog: () => Promise.resolve(null),
    saveDialog: () => Promise.resolve(null),
    openFolderDialog: () => Promise.resolve(null),
    setMenuAccelerators: () => Promise.resolve(),
    revealPath: () => Promise.resolve(),
    request: () => Promise.reject(new Error("no network in fakeHost")),
    openInNewWindow: () => Promise.resolve(),
    rename: (from, to) => {
      const f = files[from];
      if (!f) return Promise.reject(new Error(`ENOENT ${from}`));
      files[to] = f;
      delete files[from];
      return Promise.resolve();
    },
    diagnostics: () => ({ electron: "0", chromium: "0", node: "0", v8: "0", os: "test" }),
    pathForFile: () => null,
    readFile: (p) => {
      const f = files[p];
      return f ? Promise.resolve(f) : Promise.reject(new Error(`ENOENT ${p}`));
    },
    writeFile: (p, d) => {
      files[p] = d;
      return Promise.resolve();
    },
    fetchUrl: (url) => {
      const f = files[url];
      return f ? Promise.resolve(f) : Promise.reject(new Error(`offline ${url}`));
    },
    pathExists: (p) => Promise.resolve(p in files),
    gitStatus: () => Promise.resolve(""),
    mkdir: () => Promise.resolve(),
    windowMinimize: () => Promise.resolve(),
    windowToggleMaximize: () => Promise.resolve(),
    windowClose: () => Promise.resolve(),
    windowIsMaximized: () => Promise.resolve(false),
    loadSession: () => Promise.resolve(null),
    saveSession: () => Promise.resolve(),
    notifyProjectOpened: () => {},
    onOpenProjectPath: () => {},
    takePendingOpen: () => Promise.resolve(null),
    onMenuAction: () => {},
    guardClose: () => {},
    onConfirmClose: () => {},
    respondClose: () => {},
    checkForUpdates: () => Promise.resolve(),
    downloadUpdate: () => Promise.resolve(),
    quitAndInstall: () => Promise.resolve(),
    onUpdateEvent: () => {},
  };
}

test("openDocTab resolves a file:// diffuse and builds a tab", async () => {
  const doc = emptyDoc("file:///art/ship.df.png", 32, 16);
  const files = {
    "/p/ship.lmb": new TextEncoder().encode(serializeDoc(doc)),
    "/art/ship.df.png": gray(32, 16),
  };
  const { tab, droppedUnknown } = await openDocTab(fakeHost(files), "/p/ship.lmb");
  expect(tab.docPath).toBe("/p/ship.lmb");
  expect(tab.id).toBeTruthy();
  expect(tab.diffuse.bytes.length).toBeGreaterThan(0);
  expect(tab.store.state.doc.source.width).toBe(32);
  expect(droppedUnknown).toBe(0);
});

test("openDocTab rejects on dimension mismatch (NX contract)", async () => {
  const doc = emptyDoc("file:///art/ship.df.png", 64, 64);
  const files = {
    "/p/ship.lmb": new TextEncoder().encode(serializeDoc(doc)),
    "/art/ship.df.png": gray(32, 32),
  };
  await expect(openDocTab(fakeHost(files), "/p/ship.lmb")).rejects.toThrow(/64x64/);
});

test("saveTab writes the tab's docPath when it has one", async () => {
  const doc = emptyDoc("file:///art/ship.df.png", 8, 8);
  const files = { "/p/ship.lmb": new TextEncoder().encode(serializeDoc(doc)), "/art/ship.df.png": gray(8, 8) };
  const host = fakeHost(files);
  const { tab } = await openDocTab(host, "/p/ship.lmb");
  expect(await saveTab(host, tab, "/p")).toBe("/p/ship.lmb");
});

test("saveTab on an untitled tab uses the save dialog, defaulting to the source stem .lmb", async () => {
  const files: Record<string, Uint8Array> = { "/art/6powercoil.df.png": gray(8, 8) };
  let defaulted: string | undefined;
  const host: Host = {
    ...fakeHost(files),
    saveDialog: (opts) => {
      defaulted = opts.defaultPath;
      return Promise.resolve("/p/coil.lmb");
    },
    writeFile: (p, d) => {
      files[p] = d;
      return Promise.resolve();
    },
  };
  const tab = untitledTab("file:///art/6powercoil.df.png", 8, 8, gray(8, 8));
  const written = await saveTab(host, tab, "/p");
  expect(written).toBe("/p/coil.lmb");
  expect(tab.docPath).toBe("/p/coil.lmb");
  expect(defaulted).toBe("/p/6powercoil.lmb");
});

test("saveTab returns null when the save dialog is cancelled", async () => {
  const host = fakeHost({}); // default saveDialog resolves null
  const tab = untitledTab("file:///art/x.df.png", 4, 4, gray(4, 4));
  expect(await saveTab(host, tab, "/p")).toBe(null);
  expect(tab.docPath).toBe(null);
});

test("exportTabNx refuses an untitled doc (must be saved first)", async () => {
  const tab = untitledTab("file:///art/x.df.png", 8, 8, gray(8, 8));
  await expect(exportTabNx(fakeHost({}), tab, emptyProjectConfig(), "/out/x.nx.png")).rejects.toThrow(/Save the document/);
});

test("openProjectByPath reads the marker from a known folder, no dialog", async () => {
  const files = { [`/proj/${PROJECT_FILE}`]: new TextEncoder().encode(serializeProjectConfig(emptyProjectConfig())) };
  const opened = await openProjectByPath(fakeHost(files), "/proj");
  expect(opened.projectPath).toBe("/proj");
  expect(opened.config.schemaVersion).toBe(1);
});

test("openProjectByPath throws when the project marker is gone (stale recent → caller drops it)", async () => {
  await expect(openProjectByPath(fakeHost({}), "/gone")).rejects.toThrow(/isn't a Lambert project/);
});

test("newProjectFlow creates project.lambert in the chosen folder", async () => {
  const files: Record<string, Uint8Array> = {};
  const host = { ...fakeHost(files), openFolderDialog: () => Promise.resolve("/new") };
  const opened = await newProjectFlow(host);
  expect(opened?.projectPath).toBe("/new");
  expect(`/new/${PROJECT_FILE}` in files).toBe(true); // marker written
});

test("openProjectFlow opens an existing project folder", async () => {
  const files = { [`/proj/${PROJECT_FILE}`]: new TextEncoder().encode(serializeProjectConfig(emptyProjectConfig())) };
  const host = { ...fakeHost(files), openFolderDialog: () => Promise.resolve("/proj") };
  const opened = await openProjectFlow(host);
  expect(opened?.projectPath).toBe("/proj");
});

test("openProjectFlow accepts a selected project.lambert file, opening its folder", async () => {
  const files = { [`/proj/${PROJECT_FILE}`]: new TextEncoder().encode(serializeProjectConfig(emptyProjectConfig())) };
  const host = { ...fakeHost(files), openFolderDialog: () => Promise.resolve(`/proj/${PROJECT_FILE}`) };
  const opened = await openProjectFlow(host);
  expect(opened?.projectPath).toBe("/proj"); // resolved the marker file to its directory
});

test("openProjectFlow refuses a folder without project.lambert — no silent create", async () => {
  const files: Record<string, Uint8Array> = {};
  const host = { ...fakeHost(files), openFolderDialog: () => Promise.resolve("/empty") };
  await expect(openProjectFlow(host)).rejects.toThrow(/isn't a Lambert project/);
  expect(`/empty/${PROJECT_FILE}` in files).toBe(false); // nothing was written
});

test("openProjectFlow returns null when the folder dialog is cancelled", async () => {
  expect(await openProjectFlow(fakeHost({}))).toBe(null); // fakeHost.openFolderDialog resolves null
});

test("buildNxExport: nx bytes at the given out path + empty-mask warning", () => {
  let doc = emptyDoc("file:///art/hull.df.png", 32, 32);
  const empty = buildNxExport(doc, renderField(flattenLayers(doc.layers), 32, 32, { supersample: 1 }), "/p/hull.nx.png", DEFAULT_NORMAL_DIRS, DEFAULT_OUTPUT);
  expect(empty.path).toBe("/p/hull.nx.png");
  expect(empty.warning).toMatch(/empty/);
  doc = addObject(doc, ObjectTypeId.Sphere, v2(16, 16));
  const real = buildNxExport(doc, renderField(flattenLayers(doc.layers), 32, 32, { supersample: 1 }), "/p/hull.nx.png", DEFAULT_NORMAL_DIRS, DEFAULT_OUTPUT);
  expect(real.warning).toBe(null);
  expect(real.bytes.length).toBeGreaterThan(0);
});

test("buildNxExport throws when the render dims don't match the doc (NX contract)", () => {
  const doc = emptyDoc("file:///art/hull.df.png", 32, 32);
  const wrongSize = renderField(flattenLayers(doc.layers), 16, 16, { supersample: 1 }); // 16x16 != doc 32x32
  expect(() => buildNxExport(doc, wrongSize, "/p/hull.nx.png", DEFAULT_NORMAL_DIRS, DEFAULT_OUTPUT)).toThrow(/16x16.*32x32/);
});
