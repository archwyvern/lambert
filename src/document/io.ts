import { decode } from "fast-png";
import type { Host } from "../ui/host";
import { DocumentStore } from "./store";
import {
  emptyProjectConfig,
  parseDoc,
  parseProjectConfig,
  ProjectConfig,
  serializeDoc,
  serializeProjectConfig,
} from "./schema";
import { basename, dirname, joinPath } from "./paths";
import { PROJECT_FILE, Tab } from "./workspace";
import { dropUnknownLayers } from "../field/registry";
import { buildNxExport } from "./exports";
import { diffuseOpacity } from "../exporters/nx";
import { defaultDocName, resolveDiffuse } from "./diffuseSource";

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

/**
 * Open a saved `.lmb` as a tab: parse the doc, resolve + decode its diffuse (file or remote), and
 * enforce the NX dims contract. The diffuse is carried as resolved bytes; the docPath is the `.lmb`.
 */
export async function openDocTab(host: Host, docPath: string): Promise<Tab> {
  const doc = parseDoc(new TextDecoder().decode(await host.readFile(docPath)));
  const bytes = await resolveDiffuse(host, doc.source.uri);
  const decoded = decode(bytes);
  if (decoded.width !== doc.source.width || decoded.height !== doc.source.height) {
    throw new Error(
      `${basename(docPath)} diffuse is ${decoded.width}x${decoded.height} but the document expects ` +
        `${doc.source.width}x${doc.source.height} — the NX contract requires an exact match`,
    );
  }
  doc.layers = dropUnknownLayers(doc.layers); // graceful degrade: delete legacy/removed object types on load
  return { id: crypto.randomUUID(), docPath, store: new DocumentStore(doc, docPath), diffuse: { bytes } };
}

/**
 * Save the tab's `.lmb`. Untitled → a save-as dialog defaulting to the source stem (`6powercoil.df.png`
 * → `6powercoil.lmb`) in the project folder. Returns the written path, or null if the dialog was
 * cancelled. Subsequent saves overwrite the same `.lmb`.
 */
export async function saveTab(host: Host, tab: Tab, projectPath: string): Promise<string | null> {
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
 * Export the tab's NX next to its `.lmb`, named from the doc stem (the diffuse may be remote, so
 * "next to the image" is impossible). Requires a saved doc. Uses the project's normal-channel convention.
 */
export async function exportTabNx(host: Host, tab: Tab, config: ProjectConfig): Promise<string> {
  if (!tab.docPath) throw new Error("Save the document before exporting its NX");
  const { gpuExportRender } = await import("../ui/exportRender");
  const doc = tab.store.state.doc;
  const render = await gpuExportRender(doc);
  const diffuse = decode(await resolveDiffuse(host, doc.source.uri));
  const nxOutPath = joinPath(dirname(tab.docPath), basename(tab.docPath).replace(/\.lmb$/i, "") + ".nx.png");
  const file = buildNxExport(doc, render, nxOutPath, config.normalDirs, diffuseOpacity(diffuse));
  await host.writeFile(file.path, file.bytes);
  return file.warning ? `${file.path} written — WARNING: ${file.warning}` : `wrote ${file.path}`;
}
