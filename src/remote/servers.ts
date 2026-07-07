import { DavClient, type DavTransport } from "./dav";

/**
 * A configured WebDAV server — app-level settings (Preferences > Remote Servers), NOT project
 * state. Projects reference an entry by `id` from their sidecar, so credentials never live in a
 * synced file and a credential change applies to every project on this machine at once.
 *
 * Two auth modes: HTTP Basic (the WebDAV standard — Nextcloud, rclone, mod_dav) and a fixed custom
 * header (API-key servers). The DavClient itself is auth-agnostic (it just sends headers); the
 * mode lives here, per server.
 */
export type RemoteAuth =
  | { kind: "basic"; username: string; password: string }
  | { kind: "header"; header: string; key: string };

export interface RemoteServer {
  id: string;
  name: string;
  baseUrl: string;
  auth: RemoteAuth;
}

export function authHeaders(auth: RemoteAuth): Record<string, string> {
  return auth.kind === "basic"
    ? { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` }
    : { [auth.header]: auth.key };
}

export function makeDavClient(transport: DavTransport, server: RemoteServer): DavClient {
  return new DavClient(transport, server.baseUrl, authHeaders(server.auth));
}

export function newServerId(): string {
  return crypto.randomUUID();
}

/** v0.6.0 stored flat `username`/`password` on the entry; wrap legacy rows into `auth`. */
export function normalizeServer(s: unknown): RemoteServer {
  const raw = s as RemoteServer & { username?: string; password?: string };
  if (raw.auth) return raw;
  return {
    id: raw.id,
    name: raw.name,
    baseUrl: raw.baseUrl,
    auth: { kind: "basic", username: raw.username ?? "", password: raw.password ?? "" },
  };
}
