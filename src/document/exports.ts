import { encodeNxPng, nxFileName } from "../exporters/nx";
import type { RenderResult } from "../field/render";
import type { LambertDoc, NormalDirs } from "./schema";
import { basename, dirname, joinPath } from "./paths";

export interface ExportFile {
  path: string;
  bytes: Uint8Array;
  warning: string | null;
}

/** NX export next to the diffuse; warns (not errors) on an empty authored mask. The normal-channel
 *  convention is project-level (project.lambert), passed in by the caller. */
export function buildNxExport(
  doc: LambertDoc,
  render: RenderResult,
  diffusePath: string,
  normalDirs: NormalDirs,
  opaque?: Uint8Array | null,
): ExportFile {
  if (render.width !== doc.source.width || render.height !== doc.source.height) {
    throw new Error(`render ${render.width}x${render.height} != doc ${doc.source.width}x${doc.source.height}`);
  }
  const bytes = encodeNxPng(render.normals, render.mask, render.width, render.height, normalDirs, opaque);
  const empty = render.mask.every((m) => m === 0);
  return {
    path: joinPath(dirname(diffusePath), nxFileName(basename(diffusePath))),
    bytes,
    warning: empty ? "authored mask is empty — this NX changes nothing" : null,
  };
}
