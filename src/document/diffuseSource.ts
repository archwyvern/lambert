/**
 * The one place that turns a doc's `source.uri` into diffuse bytes. The scheme decides resolution:
 * `file://` reads the local filesystem on demand; `http(s)://` is fetched over the network and cached
 * (by the host). No tagged union — a single URI string, switched on scheme here. io.ts, the CLI, and
 * the exporter all call `resolveDiffuse` and never branch on scheme themselves.
 *
 * `file://` round-trips raw (no percent-encoding) so committed `.lmb` files stay human-readable and
 * paths with spaces survive — Lambert owns both ends of the format.
 */

/** The capabilities the resolver needs from its host — satisfied by the renderer Host and the CLI shim. */
export interface DiffuseHost {
  readFile(path: string): Promise<Uint8Array>;
  fetchUrl(url: string, opts?: { refresh?: boolean }): Promise<Uint8Array>;
}

export interface ParsedSourceUri {
  scheme: "file" | "http" | "https";
  /** For `file`, the absolute path (scheme stripped). For `http(s)`, the full URL unchanged. */
  value: string;
}

const FILE_PREFIX = "file://";

/** Split a source URI into its scheme + value, or throw on an unknown/malformed one. */
export function parseSourceUri(uri: string): ParsedSourceUri {
  if (uri.startsWith(FILE_PREFIX)) return { scheme: "file", value: uri.slice(FILE_PREFIX.length) };
  if (uri.startsWith("https://")) return { scheme: "https", value: uri };
  if (uri.startsWith("http://")) return { scheme: "http", value: uri };
  throw new Error(`unsupported diffuse source "${uri}" — expected a file:// or http(s):// URI`);
}

/** Wrap an absolute filesystem path as a `file://` URI (inverse of parseSourceUri for `file`). */
export function fileUri(absPath: string): string {
  return FILE_PREFIX + absPath;
}

/** Whether a source URI is fetched over the network (vs read from the local filesystem). */
export function isRemote(uri: string): boolean {
  const scheme = parseSourceUri(uri).scheme;
  return scheme === "http" || scheme === "https";
}

/** A default `.lmb` filename derived from the diffuse's stem: `…/6powercoil.df.png` -> `6powercoil.lmb`. */
export function defaultDocName(uri: string): string {
  const segment = (parseSourceUri(uri).value.split("?")[0] ?? "").split("/").pop() ?? "";
  const m = segment.match(/^(.*?)(\.df)?\.[^.]+$/);
  const stem = m ? m[1]! : segment || "untitled";
  return `${stem}.lmb`;
}

/** Resolve a source URI to diffuse bytes, switching on scheme. The only scheme-aware unit. Async so a
 *  malformed URI surfaces as a rejection (not a synchronous throw) for callers using `.catch`. */
export async function resolveDiffuse(
  host: DiffuseHost,
  uri: string,
  opts?: { refresh?: boolean },
): Promise<Uint8Array> {
  const { scheme, value } = parseSourceUri(uri);
  return scheme === "file" ? host.readFile(value) : host.fetchUrl(uri, opts);
}
