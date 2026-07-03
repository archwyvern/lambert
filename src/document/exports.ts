import { encodeNx } from "../exporters/nx";
import type { RenderResult } from "../field/render";
import type { LambertDoc, NormalDirs, OutputSettings } from "./schema";

export interface ExportFile {
  path: string;
  bytes: Uint8Array;
  warning: string | null;
}

/** The file extension an NX export gets under the given output settings (dot included). */
export function nxExtension(output: OutputSettings): string {
  return `.nx.${output.format}`;
}

/** NX export at the given output path; warns (not errors) on an empty authored mask. The normal-channel
 *  convention and output format are the doc's EFFECTIVE settings (doc override, else project), passed
 *  in by the caller, as is the output path (named from the doc stem next to the `.lmb`, since the
 *  diffuse may be remote). */
export function buildNxExport(
  doc: LambertDoc,
  render: RenderResult,
  nxOutPath: string,
  normalDirs: NormalDirs,
  output: OutputSettings,
  opaque?: Uint8Array | null,
): ExportFile {
  if (render.width !== doc.source.width || render.height !== doc.source.height) {
    throw new Error(`render ${render.width}x${render.height} != doc ${doc.source.width}x${doc.source.height}`);
  }
  const bytes = encodeNx(render.normals, render.mask, render.width, render.height, normalDirs, opaque, output);
  const empty = render.mask.every((m) => m === 0);
  const warnings: string[] = [];
  if (empty) warnings.push("authored mask is empty — this NX changes nothing");
  if (output.channels === "rg") warnings.push("RG layout drops the alpha gate — the consumer applies the override everywhere");
  return {
    path: nxOutPath,
    bytes,
    warning: warnings.length > 0 ? warnings.join("; ") : null,
  };
}
