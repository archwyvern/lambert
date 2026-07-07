import type { Host } from "./host";
import { joinPath } from "../document/paths";
import type { DavTransport } from "../remote/dav";
import type { SidecarIo } from "../remote/sidecar";
import type { LocalIo } from "../remote/runner";

/**
 * Adapters binding the Electron-free src/remote units to the renderer's real IO: the Host IPC
 * bridge (files + the net:request proxy) and carapace's fs.list (directory listing). Pure glue —
 * every behavior lives on the remote side where the fixture-server tests exercise it.
 */
export const davTransport = (host: Host): DavTransport => (req) => host.request(req);

export const sidecarIo = (host: Host): SidecarIo => ({
  read: (p) => host.readFile(p),
  write: (p, d) => host.writeFile(p, d),
  exists: (p) => host.pathExists(p),
  rename: (from, to) => host.rename(from, to),
});

export function localIo(
  host: Host,
  list: (dir: string) => Promise<{ name: string; isDir: boolean }[]>,
  projectDir: string,
): LocalIo {
  return {
    list: async () => (await list(projectDir)).filter((e) => !e.isDir).map((e) => e.name),
    read: (n) => host.readFile(joinPath(projectDir, n)),
    write: (n, d) => host.writeFile(joinPath(projectDir, n), d),
    exists: (n) => host.pathExists(joinPath(projectDir, n)),
  };
}
