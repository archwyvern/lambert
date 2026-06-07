import { encodeNxPng, nxFileName } from "../exporters/nx";
import type { RenderResult } from "../field/render";
import type { FlatlandDoc } from "./schema";
import { basename, dirname, joinPath } from "./paths";

export interface ExportFile {
  path: string;
  bytes: Uint8Array;
  warning: string | null;
}

/** NX export next to the diffuse; warns (not errors) on an empty authored mask. */
export function buildNxExport(doc: FlatlandDoc, render: RenderResult, diffusePath: string): ExportFile {
  if (render.width !== doc.source.width || render.height !== doc.source.height) {
    throw new Error(`render ${render.width}x${render.height} != doc ${doc.source.width}x${doc.source.height}`);
  }
  const bytes = encodeNxPng(render.normals, render.mask, render.width, render.height);
  const empty = render.mask.every((m) => m === 0);
  return {
    path: joinPath(dirname(diffusePath), nxFileName(basename(diffusePath))),
    bytes,
    warning: empty ? "authored mask is empty — this NX changes nothing" : null,
  };
}
