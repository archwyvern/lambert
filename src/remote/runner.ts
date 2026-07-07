import { DavClient, DavError } from "./dav";
import { planPull, planPush, sha256Hex, type LocalFile, type Sidecar, type SidecarFileRecord } from "./sync";
import { SIDECAR_FILE } from "./sidecar";

/**
 * Clone / pull / push runners — execute the pure planners' decisions over injected IO and UI, so
 * the whole feature is end-to-end testable against the fixture server with an in-memory folder and
 * scripted prompts. Rules the runners enforce (spec-normative):
 *
 *  - Nothing ever deletes a local file.
 *  - Push scope is exactly *.lmb + project.lambert (PUSH_FILTER); the sidecar never travels.
 *  - Conflict prompts (pull) and 412 blocks (push) leave the OLD record in place, so an unresolved
 *    conflict re-surfaces on the next run instead of being silently forgotten.
 *  - Runners return an updated Sidecar copy; the CALLER persists it (saveSidecar).
 */
export interface LocalIo {
  /** Flat file names in the project root (no directories). */
  list(): Promise<string[]>;
  read(name: string): Promise<Uint8Array>;
  write(name: string, data: Uint8Array): Promise<void>;
  exists(name: string): Promise<boolean>;
}

export interface SyncUi {
  progress(message: string, done: number, total: number): void;
  /** Pull conflict: remote AND local changed. true = overwrite local with remote. */
  confirmOverwriteLocal(name: string): Promise<boolean>;
  info(message: string): void;
}

export interface PullSummary {
  downloaded: string[];
  fastForwarded: string[];
  conflictsOverwritten: string[];
  conflictsKept: string[];
  keptLocal: string[];
  failed: { name: string; error: string }[];
}

export interface PushSummary {
  uploaded: string[];
  skipped: string[];
  /** 412: remote changed since last pull — Sync first. */
  blocked: string[];
  failed: { name: string; error: string }[];
}

/** The push scope: documents + the project file. Everything else travels download-only. */
export const PUSH_FILTER = (name: string): boolean =>
  name !== SIDECAR_FILE && !name.startsWith(SIDECAR_FILE) && (/\.lmb$/i.test(name) || name === "project.lambert");

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function record(etag: string, data: Uint8Array): Promise<SidecarFileRecord> {
  return { etag, size: data.byteLength, sha256: await sha256Hex(data) };
}

/** Download every remote file into an (empty) local folder; per-file failures don't abort the rest. */
export async function cloneProject(
  dav: DavClient,
  project: string,
  serverId: string,
  io: LocalIo,
  ui: SyncUi,
): Promise<{ sidecar: Sidecar; failed: string[] }> {
  const remote = await dav.listFiles(project);
  const files: Record<string, SidecarFileRecord> = {};
  const failed: string[] = [];
  for (const [i, entry] of remote.entries()) {
    ui.progress(entry.name, i + 1, remote.length);
    try {
      const bytes = await dav.getFile(project, entry.name);
      await io.write(entry.name, bytes);
      files[entry.name] = await record(entry.etag, bytes);
    } catch (e) {
      failed.push(entry.name);
      ui.info(`Failed to download ${entry.name}: ${errText(e)}`);
    }
  }
  return { sidecar: { serverId, projectPath: project, lastPull: new Date().toISOString(), files }, failed };
}

/** Hash the local side of the given names (missing files are simply absent from the result). */
async function scanLocal(io: LocalIo, names: string[]): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  for (const name of names) {
    if (!(await io.exists(name))) continue;
    out.push({ name, sha256: await sha256Hex(await io.read(name)) });
  }
  return out;
}

export async function runPull(
  dav: DavClient,
  sidecar: Sidecar,
  io: LocalIo,
  ui: SyncUi,
): Promise<{ sidecar: Sidecar; summary: PullSummary }> {
  const remote = await dav.listFiles(sidecar.projectPath);
  const local = await scanLocal(io, remote.map((r) => r.name));
  const plan = planPull(remote, local, sidecar);
  const remoteByName = new Map(remote.map((r) => [r.name, r]));
  const files = { ...sidecar.files };
  const summary: PullSummary = { downloaded: [], fastForwarded: [], conflictsOverwritten: [], conflictsKept: [], keptLocal: [], failed: [] };

  const download = async (name: string): Promise<void> => {
    const bytes = await dav.getFile(sidecar.projectPath, name);
    await io.write(name, bytes);
    files[name] = await record(remoteByName.get(name)!.etag, bytes);
  };

  for (const [i, action] of plan.entries()) {
    ui.progress(action.name, i + 1, plan.length);
    try {
      switch (action.kind) {
        case "download":
          await download(action.name);
          summary.downloaded.push(action.name);
          break;
        case "fast-forward":
          await download(action.name);
          summary.fastForwarded.push(action.name);
          break;
        case "skip":
          break;
        case "keep-local":
          summary.keptLocal.push(action.name);
          break;
        case "conflict":
          if (await ui.confirmOverwriteLocal(action.name)) {
            await download(action.name);
            summary.conflictsOverwritten.push(action.name);
          } else {
            summary.conflictsKept.push(action.name); // record stays OLD -> re-prompts next pull
          }
          break;
      }
    } catch (e) {
      summary.failed.push({ name: action.name, error: errText(e) });
    }
  }
  return { sidecar: { ...sidecar, lastPull: new Date().toISOString(), files }, summary };
}

export async function runPush(
  dav: DavClient,
  sidecar: Sidecar,
  io: LocalIo,
  ui: SyncUi,
): Promise<{ sidecar: Sidecar; summary: PushSummary }> {
  const names = (await io.list()).filter(PUSH_FILTER);
  const local = await scanLocal(io, names);
  const plan = planPush(local, sidecar);
  const files = { ...sidecar.files };
  const summary: PushSummary = { uploaded: [], skipped: [], blocked: [], failed: [] };

  for (const [i, action] of plan.entries()) {
    ui.progress(action.name, i + 1, plan.length);
    if (action.kind === "skip") {
      summary.skipped.push(action.name);
      continue;
    }
    try {
      const bytes = await io.read(action.name);
      const etag = await dav.putFile(
        sidecar.projectPath,
        action.name,
        bytes,
        action.kind === "update" ? { ifMatch: action.ifMatch } : { ifNoneMatch: true },
      );
      files[action.name] = await record(etag, bytes);
      summary.uploaded.push(action.name);
    } catch (e) {
      if (e instanceof DavError && e.status === 412) {
        summary.blocked.push(action.name); // record stays OLD; Sync resolves, then push retries
      } else {
        summary.failed.push({ name: action.name, error: errText(e) });
      }
    }
  }
  return { sidecar: { ...sidecar, files }, summary };
}
