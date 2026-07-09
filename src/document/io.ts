import { decode } from "fast-png";
import type { Host } from "../ui/host";
import { DocumentStore } from "./store";
import { type LambertDoc,
  effectiveNormalDirs,
  effectiveOutput,
  emptyProjectConfig,
  parseDoc,
  parseProjectConfig,
  ProjectConfig,
  serializeDoc,
  serializeProjectConfig,
} from "./schema";
import { basename, dirname, joinPath } from "./paths";
import { PROJECT_FILE, type DocTab } from "./workspace";
import { countUnknownLayers } from "../field/registry";
import { buildNxExport, type ExportFile } from "./exports";
import { diffuseOpacity } from "../exporters/nx";
import { defaultDocName, healDiffuse, resolveDiffuse } from "./diffuseSource";

export interface OpenedProject {
  projectPath: string;
  config: ProjectConfig;
}

/** Write a fresh project.lambert into `dir` and return its config. */
export async function initProject(host: Host, dir: string): Promise<ProjectConfig> {
  const config = emptyProjectConfig();
  await host.writeFile(joinPath(dir, PROJECT_FILE), new TextEncoder().encode(serializeProjectConfig(config)));
  return config;
}

/**
 * Open a project directly from a known folder path (no dialog) — for one-click reopen from the
 * recent list and for opening a double-clicked project.lambert. Throws if `dir` doesn't hold a
 * project.lambert, so opening a non-project folder fails loudly instead of silently creating one
 * (New Project is the only thing that creates a marker).
 */
export async function openProjectByPath(host: Host, dir: string): Promise<OpenedProject> {
  const marker = joinPath(dir, PROJECT_FILE);
  if (!(await host.pathExists(marker))) {
    throw new Error(`${basename(dir)} isn't a Lambert project (no ${PROJECT_FILE}) — use New Project to create one`);
  }
  const config = parseProjectConfig(new TextDecoder().decode(await host.readFile(marker)));
  return { projectPath: dir, config };
}

/**
 * Folder picker → open an EXISTING project. Accepts either the project folder OR a selected
 * project.lambert file (resolved to its folder), so picking the marker works like picking the dir.
 * The folder must already contain project.lambert.
 */
export async function openProjectFlow(host: Host, defaultPath?: string): Promise<OpenedProject | null> {
  const picked = await host.openFolderDialog({ title: "Open project (folder or project.lambert)", defaultPath });
  if (!picked) return null; // dialog cancelled
  const dir = basename(picked) === PROJECT_FILE ? dirname(picked) : picked;
  return openProjectByPath(host, dir);
}

/** New project: pick an (ideally empty) folder and write project.lambert. */
export async function newProjectFlow(host: Host, defaultPath?: string): Promise<OpenedProject | null> {
  const dir = await host.openFolderDialog({ title: "New project — choose a folder", defaultPath });
  if (!dir) return null;
  const marker = joinPath(dir, PROJECT_FILE);
  const config = (await host.pathExists(marker))
    ? parseProjectConfig(new TextDecoder().decode(await host.readFile(marker)))
    : await initProject(host, dir);
  return { projectPath: dir, config };
}

/** The diffuse changed size underneath a document. Carries everything the UI needs to offer the
 *  adopt-vs-scale migration (see document/migrate.ts) instead of a dead-end refusal. */
export class DimsMismatchError extends Error {
  constructor(
    readonly docPath: string,
    readonly doc: LambertDoc,
    readonly bytes: Uint8Array,
    readonly width: number,
    readonly height: number,
  ) {
    super(
      `${basename(docPath)} diffuse is ${width}x${height} but the document expects ` +
        `${doc.source.width}x${doc.source.height}`,
    );
  }
}

/**
 * Open a saved `.lmb` as a tab: parse the doc, resolve + decode its diffuse (file or remote), and
 * enforce the NX dims contract (a mismatch throws DimsMismatchError so the UI can offer the resize
 * migration). The diffuse is carried as resolved bytes; the docPath is the `.lmb`.
 * `droppedUnknown` is how many legacy/removed-type object layers were dropped on load (the drop is
 * intended graceful-degrade; the count lets the caller tell the user it happened).
 */
export async function openDocTab(host: Host, docPath: string, projectPath: string): Promise<{ tab: DocTab; droppedUnknown: number }> {
  let doc = parseDoc(new TextDecoder().decode(await host.readFile(docPath)));
  let bytes: Uint8Array;
  try {
    bytes = await resolveDiffuse(host, doc.source.uri, { baseDir: projectPath });
  } catch (err) {
    // A dead absolute path (this .lmb came from another machine's clone, or the folder moved):
    // re-anchor it under the current project root and carry the portable relative form forward —
    // it persists on the next save, so the doc self-heals per machine with no prompt.
    const healed = await healDiffuse(host, doc.source.uri, projectPath);
    if (!healed) throw err;
    doc = { ...doc, source: { ...doc.source, uri: healed.uri } };
    bytes = healed.bytes;
  }
  const decoded = decode(bytes);
  if (decoded.width !== doc.source.width || decoded.height !== doc.source.height) {
    throw new DimsMismatchError(docPath, doc, bytes, decoded.width, decoded.height);
  }
  const droppedUnknown = countUnknownLayers(doc.layers);
  const tab: DocTab = { kind: "doc", id: crypto.randomUUID(), docPath, store: new DocumentStore(doc, docPath), diffuse: { bytes } };
  return { tab, droppedUnknown };
}

/**
 * Save the tab's `.lmb`. Untitled → a save-as dialog defaulting to the source stem (`6powercoil.df.png`
 * → `6powercoil.lmb`) in the project folder. Returns the written path, or null if the dialog was
 * cancelled. Subsequent saves overwrite the same `.lmb`.
 */
export async function saveTab(host: Host, tab: DocTab, projectPath: string): Promise<string | null> {
  let path = tab.docPath;
  if (!path) {
    path = await host.saveDialog({
      title: "Save document",
      defaultPath: joinPath(projectPath, defaultDocName(tab.store.state.doc.source.uri)),
      filters: [{ name: "Lambert document", extensions: ["lmb"] }],
    });
    if (!path) return null; // cancelled
  }
  await host.writeFile(path, new TextEncoder().encode(serializeDoc(tab.store.state.doc)));
  tab.docPath = path;
  tab.store.markSaved(path);
  return path;
}

/**
 * Export ONE document's NX to `outPath` (project normal-channel convention). Doc-based, not
 * tab-based, so the project-wide sweep can export `.lmb` files that aren't open; `label` names the
 * doc in errors (a path or filename).
 */
/** Render a doc's NX to bytes + final path WITHOUT writing — the remote exporter uploads the
 *  result instead. exportDocNx is the write-to-disk wrapper. */
export async function renderDocNx(host: Host, doc: LambertDoc, label: string, config: ProjectConfig, outPath: string, projectPath: string): Promise<ExportFile> {
  const { gpuExportRender } = await import("../ui/exportRender");
  const bytes = await resolveDiffuse(host, doc.source.uri, { baseDir: projectPath });
  const { detailChainParams } = await import("../field/adjustments");
  const { detailFieldForDiffuse } = await import("../field/detail");
  const chain = detailChainParams(doc.layers, config.adjustmentDefaults);
  const detail = chain ? detailFieldForDiffuse(bytes, chain) : null;
  const render = await gpuExportRender(doc, detail, config.adjustmentDefaults);
  const diffuse = decode(bytes);
  // Re-validate dims before the alpha gate: if the diffuse changed size since the doc was opened, its
  // opacity[] would be the wrong length and encodeNxPng would index out of range → corrupt NX alpha.
  // openDocTab checks on open, but the file can change underneath us before an export.
  if (diffuse.width !== doc.source.width || diffuse.height !== doc.source.height) {
    throw new Error(
      `${basename(label)} diffuse is ${diffuse.width}x${diffuse.height} but the document expects ` +
        `${doc.source.width}x${doc.source.height} — open the document to adopt or scale to the new size`,
    );
  }
  return buildNxExport(doc, render, outPath, effectiveNormalDirs(doc, config), effectiveOutput(doc, config), diffuseOpacity(diffuse));
}

export async function exportDocNx(host: Host, doc: LambertDoc, label: string, config: ProjectConfig, outPath: string, projectPath: string): Promise<string> {
  const file = await renderDocNx(host, doc, label, config, outPath, projectPath);
  await host.writeFile(file.path, file.bytes);
  return file.warning ? `${file.path} written — WARNING: ${file.warning}` : `wrote ${file.path}`;
}

/** Export the active tab's LIVE document (unsaved edits included). Requires a saved doc for naming. */
export async function exportTabNx(host: Host, tab: DocTab, config: ProjectConfig, outPath: string, projectPath: string): Promise<string> {
  if (!tab.docPath) throw new Error("Save the document before exporting its NX");
  return exportDocNx(host, tab.store.state.doc, tab.docPath, config, outPath, projectPath);
}

/** Export the active tab's height field as 16-bit grayscale PNG (heights normalized min->0,
 *  max->65535). Same ss2 render as the NX; no diffuse involvement (the height field is authored). */
export async function exportTabHeightmap(host: Host, tab: DocTab, config: ProjectConfig, outPath: string): Promise<string> {
  if (!tab.docPath) throw new Error("Save the document before exporting its height map");
  const { gpuExportRender } = await import("../ui/exportRender");
  const doc = tab.store.state.doc;
  const { detailChainParams } = await import("../field/adjustments");
  const { detailFieldForDiffuse } = await import("../field/detail");
  const chain = detailChainParams(doc.layers, config.adjustmentDefaults);
  const detail = chain ? detailFieldForDiffuse(tab.diffuse.bytes, chain) : null;
  const render = await gpuExportRender(doc, detail, config.adjustmentDefaults);
  const { encodeHeightmapPng } = await import("../exporters/heightmap");
  await host.writeFile(outPath, encodeHeightmapPng(render));
  return `wrote ${outPath}`;
}
