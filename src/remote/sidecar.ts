import { z } from "zod";
import { joinPath } from "../document/paths";
import type { Sidecar } from "./sync";

/**
 * `.lambert-remote.json` — machine-local sync state in the project root. Deliberately NOT part of
 * project.lambert: the project file is itself synced, and a synced file can't carry bookkeeping
 * about its own sync (two machines would fight over it; every pull would dirty it). The sidecar is
 * never uploaded (the push filter excludes it by name).
 *
 * A project "is remote" iff this file exists. Corruption is a soft state — the caller warns and the
 * recovery is re-clone — so load returns "corrupt" instead of throwing.
 */
export const SIDECAR_FILE = ".lambert-remote.json";

export interface SidecarIo {
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
}

const sidecarSchema = z.object({
  serverId: z.string(),
  baseUrl: z.string(),
  projectPath: z.string(),
  lastPull: z.string(),
  files: z.record(z.string(), z.object({ etag: z.string(), size: z.number(), sha256: z.string() })),
});

export function parseSidecar(json: string): Sidecar {
  return sidecarSchema.parse(JSON.parse(json));
}

export function serializeSidecar(s: Sidecar): string {
  return JSON.stringify(s, null, 2);
}

export async function loadSidecar(io: SidecarIo, projectDir: string): Promise<Sidecar | null | "corrupt"> {
  const path = joinPath(projectDir, SIDECAR_FILE);
  if (!(await io.exists(path))) return null;
  try {
    return parseSidecar(new TextDecoder().decode(await io.read(path)));
  } catch {
    return "corrupt";
  }
}

/** Atomic save: write `.tmp`, then rename over the real file — a crash never half-writes the state. */
export async function saveSidecar(io: SidecarIo, projectDir: string, s: Sidecar): Promise<void> {
  const path = joinPath(projectDir, SIDECAR_FILE);
  const tmp = `${path}.tmp`;
  await io.write(tmp, new TextEncoder().encode(serializeSidecar(s)));
  await io.rename(tmp, path);
}
