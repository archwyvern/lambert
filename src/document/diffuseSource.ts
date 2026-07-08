/**
 * The one place that turns a doc's `source.uri` into diffuse bytes. The scheme decides resolution:
 * `file://` reads the local filesystem on demand; `http(s)://` is fetched over the network and cached
 * (by the host); a bare relative path is PROJECT-RELATIVE — resolved against the project root the
 * caller passes as `baseDir` — which is what makes an .lmb portable across machines/clones (the
 * remote-projects workflow). No tagged union — a single URI string, switched on scheme here. io.ts,
 * the CLI, and the exporter all call `resolveDiffuse` and never branch on scheme themselves.
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
  scheme: "file" | "http" | "https" | "relative";
  /** For `file`, the absolute path (scheme stripped). For `http(s)`, the full URL unchanged.
   *  For `relative`, a project-root-relative path (no leading ./ or /). */
  value: string;
}

const FILE_PREFIX = "file://";

/** Split a source URI into its scheme + value, or throw on an unknown/malformed one. */
export function parseSourceUri(uri: string): ParsedSourceUri {
  if (uri.startsWith(FILE_PREFIX)) return { scheme: "file", value: uri.slice(FILE_PREFIX.length) };
  if (uri.startsWith("https://")) return { scheme: "https", value: uri };
  if (uri.startsWith("http://")) return { scheme: "http", value: uri };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri) || uri.startsWith("/") || uri.includes("\\")) {
    // an unknown scheme, an absolute bare path (must wear file://), or a Windows-style path
    throw new Error(`unsupported diffuse source "${uri}" — expected a project-relative path, file:// or http(s):// URI`);
  }
  const value = uri.replace(/^\.\//, "");
  if (value.length === 0 || value.split("/").includes("..")) {
    throw new Error(`unsupported diffuse source "${uri}" — a relative source must stay inside the project`);
  }
  return { scheme: "relative", value };
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
 *  malformed URI surfaces as a rejection (not a synchronous throw) for callers using `.catch`.
 *  `baseDir` (the project root) anchors relative sources; resolving one without it is a caller bug. */
export async function resolveDiffuse(
  host: DiffuseHost,
  uri: string,
  opts?: { refresh?: boolean; baseDir?: string },
): Promise<Uint8Array> {
  const { scheme, value } = parseSourceUri(uri);
  if (scheme === "relative") {
    if (!opts?.baseDir) throw new Error(`relative diffuse source "${uri}" needs the project root (baseDir)`);
    return host.readFile(joinBase(opts.baseDir, value));
  }
  return scheme === "file" ? host.readFile(value) : host.fetchUrl(uri, opts);
}

function joinBase(baseDir: string, rel: string): string {
  return baseDir.endsWith("/") ? baseDir + rel : `${baseDir}/${rel}`;
}

/** The portable form of a source URI: a `file://` path inside the project collapses to
 *  project-relative; everything else passes through. Called at doc creation/relink so new
 *  documents are clone-portable from the start. */
export function relativizeSourceUri(uri: string, projectPath: string): string {
  const parsed = parseSourceUri(uri);
  if (parsed.scheme !== "file") return uri;
  const root = projectPath.endsWith("/") ? projectPath : `${projectPath}/`;
  return parsed.value.startsWith(root) ? parsed.value.slice(root.length) : uri;
}

/**
 * Re-anchor a DEAD absolute `file://` source under the current project root: try each suffix of
 * its path (longest first, down to the basename) and return the first that reads, as the portable
 * relative form. Heals .lmb files exported before relative sources existed (or from another
 * machine's clone) the first time they open here. Null = nothing matched (caller keeps its
 * normal failure path); http(s)/relative sources are never healed.
 */
export async function healDiffuse(
  host: DiffuseHost,
  uri: string,
  projectPath: string,
): Promise<{ uri: string; bytes: Uint8Array } | null> {
  let parsed: ParsedSourceUri;
  try {
    parsed = parseSourceUri(uri);
  } catch {
    return null;
  }
  if (parsed.scheme !== "file") return null;
  const segments = parsed.value.split("/").filter(Boolean);
  for (let i = 1; i < segments.length; i++) {
    const candidate = segments.slice(i).join("/");
    try {
      const bytes = await host.readFile(joinBase(projectPath, candidate));
      return { uri: candidate, bytes };
    } catch {
      // keep shortening
    }
  }
  return null;
}
