import { decode } from "fast-png";
import type { Host } from "../ui/host";
import { DocumentStore } from "./store";
import {
  emptyDoc,
  emptyProjectConfig,
  parseDoc,
  parseProjectConfig,
  ProjectConfig,
  serializeDoc,
  serializeProjectConfig,
} from "./schema";
import { basename, dirname, joinPath } from "./paths";
import { legacySidecarCandidates, PROJECT_FILE, sidecarPath, Tab } from "./workspace";
import { buildNxExport } from "./exports";
import { diffuseOpacity } from "../exporters/nx";

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

/** Folder picker → open the project (reading project.lambert), or initialize one if absent. */
export async function openProjectFlow(host: Host): Promise<OpenedProject | null> {
  const dir = await host.openFolderDialog({ title: "Open project folder" });
  if (!dir) return null;
  const marker = joinPath(dir, PROJECT_FILE);
  const config = (await host.pathExists(marker))
    ? parseProjectConfig(new TextDecoder().decode(await host.readFile(marker)))
    : await initProject(host, dir);
  return { projectPath: dir, config };
}

/** New project: pick an (ideally empty) folder and write project.lambert. */
export async function newProjectFlow(host: Host): Promise<OpenedProject | null> {
  const dir = await host.openFolderDialog({ title: "New project — choose a folder" });
  if (!dir) return null;
  const marker = joinPath(dir, PROJECT_FILE);
  const config = (await host.pathExists(marker))
    ? parseProjectConfig(new TextDecoder().decode(await host.readFile(marker)))
    : await initProject(host, dir);
  return { projectPath: dir, config };
}

/** First existing sidecar (.lnb, then legacy .lambert/.flatland) for an image, or null. */
async function resolveSidecar(host: Host, imagePath: string): Promise<string | null> {
  for (const candidate of legacySidecarCandidates(imagePath)) {
    if (await host.pathExists(candidate)) return candidate;
  }
  return null;
}

/** Whether an image already has authored shape data (badge helper). */
export async function hasSidecar(host: Host, imagePath: string): Promise<boolean> {
  return (await resolveSidecar(host, imagePath)) !== null;
}

/**
 * Open an image as a tab: load its sidecar doc (or start an empty one), read the diffuse, and
 * enforce the NX dims contract. docPath is the existing sidecar (may be legacy) or null when
 * unsaved; saveTab always writes the `.lnb`, migrating legacy sidecars on first save.
 */
export async function openImageTab(host: Host, imagePath: string): Promise<Tab> {
  const diffuseBytes = await host.readFile(imagePath);
  const decoded = decode(diffuseBytes);
  const sidecar = await resolveSidecar(host, imagePath);
  let docPath: string | null = null;
  let doc;
  if (sidecar) {
    doc = parseDoc(new TextDecoder().decode(await host.readFile(sidecar)));
    if (decoded.width !== doc.source.width || decoded.height !== doc.source.height) {
      throw new Error(
        `${basename(imagePath)} is ${decoded.width}x${decoded.height} but its document expects ` +
          `${doc.source.width}x${doc.source.height} — the NX contract requires an exact match`,
      );
    }
    docPath = sidecar;
  } else {
    doc = emptyDoc(basename(imagePath), decoded.width, decoded.height);
  }
  return {
    imagePath,
    docPath,
    store: new DocumentStore(doc, docPath),
    diffuse: { bytes: diffuseBytes, dir: dirname(imagePath) },
  };
}

/** Write the tab's `.lnb` sidecar (creating/migrating it), update docPath, clear dirty. */
export async function saveTab(host: Host, tab: Tab): Promise<string> {
  const path = sidecarPath(tab.imagePath);
  await host.writeFile(path, new TextEncoder().encode(serializeDoc(tab.store.state.doc)));
  tab.docPath = path;
  tab.store.markSaved(path);
  return path;
}

/** Export the tab's NX next to its image, using the project's normal-channel convention. */
export async function exportTabNx(host: Host, tab: Tab, config: ProjectConfig): Promise<string> {
  const { gpuExportRender } = await import("../ui/exportRender");
  const render = await gpuExportRender(tab.store.state.doc);
  const diffuse = decode(await host.readFile(tab.imagePath));
  const file = buildNxExport(tab.store.state.doc, render, tab.imagePath, config.normalDirs, diffuseOpacity(diffuse));
  await host.writeFile(file.path, file.bytes);
  return file.warning ? `${file.path} written — WARNING: ${file.warning}` : `wrote ${file.path}`;
}
