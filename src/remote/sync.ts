import type { RemoteEntry } from "./dav";

/**
 * Pure sync planners — the decision heart of remote projects, kept IO-free so the full conflict
 * matrix is table-testable. Three-way comparison per file:
 *
 *   remote etag   vs recorded etag   -> did the server side change since the last pull?
 *   local sha256  vs recorded sha256 -> did the local file change since the last pull?
 *
 * Etags are opaque (never derived from content); sha256 is computed locally both at record time
 * and at plan time, so "modified" is content truth, not an mtime heuristic.
 */
export interface SidecarFileRecord {
  etag: string;
  size: number;
  sha256: string;
}

export interface Sidecar {
  /** Remote Servers entry id (credentials/baseUrl live in app settings, not in the project). */
  serverId: string;
  /** Collection name on the server. */
  projectPath: string;
  /** ISO timestamp of the last successful clone/pull. */
  lastPull: string;
  files: Record<string, SidecarFileRecord>;
}

export interface LocalFile {
  name: string;
  sha256: string;
}

export type PullAction =
  | { name: string; kind: "download" } // no local file (new remote, or locally deleted -> restore)
  | { name: string; kind: "skip" } // unmodified both sides
  | { name: string; kind: "fast-forward" } // remote changed, local untouched -> silent download
  | { name: string; kind: "keep-local" } // local ahead, remote unchanged -> Export's business
  | { name: string; kind: "conflict" }; // both changed -> prompt

export type PushAction =
  | { name: string; kind: "skip" }
  | { name: string; kind: "update"; ifMatch: string } // record exists, content changed
  | { name: string; kind: "create" }; // no record -> If-None-Match: *

/** One pull decision per REMOTE file (pull never deletes, so local-only files are not its concern). */
export function planPull(remote: RemoteEntry[], local: LocalFile[], sidecar: Sidecar): PullAction[] {
  const localByName = new Map(local.map((f) => [f.name, f]));
  return remote.map((r) => {
    const loc = localByName.get(r.name);
    if (!loc) return { name: r.name, kind: "download" as const };
    const rec = sidecar.files[r.name];
    const localModified = !rec || loc.sha256 !== rec.sha256;
    const remoteChanged = !rec || r.etag !== rec.etag;
    if (!localModified && !remoteChanged) return { name: r.name, kind: "skip" as const };
    if (!localModified) return { name: r.name, kind: "fast-forward" as const };
    if (!remoteChanged) return { name: r.name, kind: "keep-local" as const };
    return { name: r.name, kind: "conflict" as const };
  });
}

/** One push decision per LOCAL file. Callers pass the already-filtered push set (lmb + project.lambert). */
export function planPush(local: LocalFile[], sidecar: Sidecar): PushAction[] {
  return local.map((f) => {
    const rec = sidecar.files[f.name];
    if (!rec) return { name: f.name, kind: "create" as const };
    if (f.sha256 === rec.sha256) return { name: f.name, kind: "skip" as const };
    return { name: f.name, kind: "update" as const, ifMatch: rec.etag };
  });
}

/** sha256 hex via WebCrypto — available in the renderer and in node (>=18) alike. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
