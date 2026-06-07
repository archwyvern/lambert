import { decode } from "fast-png";
import type { Host } from "../ui/host";
import type { DocumentStore } from "./store";
import { emptyDoc, FlatlandDoc, parseDoc, serializeDoc } from "./schema";
import { basename, dirname, joinPath } from "./paths";
import { buildNxExport } from "./exports";

const PNG = [{ name: "PNG image", extensions: ["png"] }];
const FLATLAND = [{ name: "Flatland project", extensions: ["flatland"] }];

export interface LoadedProject {
  doc: FlatlandDoc;
  docPath: string;
  diffuseBytes: Uint8Array;
  diffuseDir: string;
}

/** The absolute diffuse path for the store's current doc (sidecar state, not in the doc). */
export const diffusePathByStore = new WeakMap<DocumentStore, string>();

/** Open a .flatland: parse, resolve + read the diffuse, enforce the dims contract. */
export async function loadProject(host: Host, docPath: string): Promise<LoadedProject> {
  const doc = parseDoc(new TextDecoder().decode(await host.readFile(docPath)));
  const diffusePath = joinPath(dirname(docPath), doc.source.path);
  const diffuseBytes = await host.readFile(diffusePath);
  const decoded = decode(diffuseBytes);
  if (decoded.width !== doc.source.width || decoded.height !== doc.source.height) {
    throw new Error(
      `diffuse is ${decoded.width}x${decoded.height} but the document expects ` +
        `${doc.source.width}x${doc.source.height} — the NX contract requires an exact match`,
    );
  }
  return { doc, docPath, diffuseBytes, diffuseDir: dirname(docPath) };
}

type SetDiffuse = (d: { bytes: Uint8Array; dir: string | null } | null) => void;

export async function openImageFlow(host: Host, store: DocumentStore, setDiffuse: SetDiffuse): Promise<void> {
  const path = await host.openDialog({ title: "Open diffuse image", filters: PNG });
  if (!path) return;
  const bytes = await host.readFile(path);
  const decoded = decode(bytes);
  const doc = emptyDoc(basename(path), decoded.width, decoded.height);
  store.reset(doc, null);
  diffusePathByStore.set(store, path);
  setDiffuse({ bytes, dir: dirname(path) });
}

export async function openProjectFlow(host: Host, store: DocumentStore, setDiffuse: SetDiffuse): Promise<void> {
  const path = await host.openDialog({ title: "Open project", filters: FLATLAND });
  if (!path) return;
  const loaded = await loadProject(host, path);
  store.reset(loaded.doc, loaded.docPath);
  diffusePathByStore.set(store, joinPath(loaded.diffuseDir, loaded.doc.source.path));
  setDiffuse({ bytes: loaded.diffuseBytes, dir: loaded.diffuseDir });
}

export async function saveFlow(host: Host, store: DocumentStore, saveAs: boolean): Promise<void> {
  const diffusePath = diffusePathByStore.get(store);
  if (!diffusePath) throw new Error("no document to save");
  let path = store.state.docPath;
  if (saveAs || !path) {
    const stem = basename(diffusePath).replace(/(\.df)?\.png$/i, "");
    path = await host.saveDialog({
      title: "Save project",
      defaultPath: joinPath(dirname(diffusePath), `${stem}.flatland`),
      filters: FLATLAND,
    });
    if (!path) return;
  }
  // store the diffuse path relative to the doc when it lives under the doc's directory
  const docDir = dirname(path);
  const rel = diffusePath.startsWith(docDir + "/") ? diffusePath.slice(docDir.length + 1) : diffusePath;
  if (rel !== store.state.doc.source.path) {
    store.update((d) => ({ ...d, source: { ...d.source, path: rel } }));
    store.endGesture();
  }
  await host.writeFile(path, new TextEncoder().encode(serializeDoc(store.state.doc)));
  store.markSaved(path);
}

export async function exportNx(host: Host, store: DocumentStore): Promise<string> {
  const diffusePath = diffusePathByStore.get(store);
  if (!diffusePath) throw new Error("no document to export");
  const { gpuExportRender } = await import("../ui/exportRender");
  const render = await gpuExportRender(store.state.doc);
  const file = buildNxExport(store.state.doc, render, diffusePath);
  await host.writeFile(file.path, file.bytes);
  return file.warning ? `${file.path} written — WARNING: ${file.warning}` : `wrote ${file.path}`;
}
