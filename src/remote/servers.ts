import { DavClient, type DavTransport } from "./dav";

/**
 * A configured WebDAV server — app-level settings (Preferences > Remote Servers), NOT project
 * state. Projects reference an entry by `id` from their sidecar, so credentials never live in a
 * synced file and a password change applies to every project on this machine at once.
 */
export interface RemoteServer {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
}

export function makeDavClient(transport: DavTransport, server: RemoteServer): DavClient {
  return new DavClient(transport, server.baseUrl, { username: server.username, password: server.password });
}

export function newServerId(): string {
  return crypto.randomUUID();
}
