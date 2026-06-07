import { serializeDoc } from "../document/schema";
import type { FlatlandDoc } from "../document/schema";

/** Everything the pop-out 3D window needs to re-fold the field in its own GPU device. */
export interface View3DState {
  docJson: string;
  diffuse: Uint8Array | null;
  lightDir: [number, number, number];
}

export function build3DState(
  doc: FlatlandDoc,
  diffuse: Uint8Array | null,
  lightDir: [number, number, number],
): View3DState {
  return { docJson: serializeDoc(doc), diffuse, lightDir };
}
