/**
 * Minimal WebDAV client — exactly the subset the remote-projects feature needs (see the spec's
 * contract table): PROPFIND Depth 0/1, GET, PUT with If-Match / If-None-Match, HTTP Basic auth.
 *
 * Transport is injected: the renderer passes Host.request (a main-process fetch proxy — custom
 * methods + no CORS), tests pass a plain fetch adapter. This module is Electron-free by design.
 *
 * Etags are OPAQUE validators. This client strips quotes/W\/ prefixes for stable comparison but
 * never derives an etag from content — equality with a recorded value is the only operation.
 */
export interface DavRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

export interface DavResponse {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  body: Uint8Array;
}

export type DavTransport = (req: DavRequest) => Promise<DavResponse>;

export interface RemoteEntry {
  name: string;
  etag: string;
  size: number;
}

export class DavError extends Error {
  constructor(
    readonly status: number,
    readonly op: string,
    readonly target: string,
  ) {
    super(`${op} ${target}: HTTP ${status}`);
  }
}

export type PutPrecondition = { ifMatch: string } | { ifNoneMatch: true } | null;

/** Strip surrounding quotes and a weak-validator prefix; comparison happens on the bare value. */
function bareEtag(raw: string): string {
  return raw.replace(/^W\//, "").replace(/^"|"$/g, "");
}

/** Last non-empty path segment of a multistatus href, decoded. */
function hrefName(href: string): string {
  const segs = href.split("?")[0]!.split("/").filter(Boolean);
  return segs.length ? decodeURIComponent(segs[segs.length - 1]!) : "";
}

interface ParsedResponse {
  href: string;
  collection: boolean;
  etag: string;
  size: number;
}

/** Parse a 207 multistatus by localName so any namespace prefix (D:, d:, none) works. */
function parseMultistatus(xml: string): ParsedResponse[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const out: ParsedResponse[] = [];
  for (const el of Array.from(doc.getElementsByTagNameNS("DAV:", "response"))) {
    let href = "";
    let collection = false;
    let etag = "";
    let size = 0;
    const walk = (node: Element): void => {
      for (const child of Array.from(node.children)) {
        switch (child.localName) {
          case "href":
            href = child.textContent ?? "";
            break;
          case "getetag":
            etag = bareEtag((child.textContent ?? "").trim());
            break;
          case "getcontentlength":
            size = Number(child.textContent ?? 0);
            break;
          case "collection":
            collection = true;
            break;
          default:
            walk(child);
        }
      }
    };
    walk(el);
    out.push({ href, collection, etag, size });
  }
  return out;
}

export class DavClient {
  private readonly base: string;
  private readonly authorization: string;

  constructor(
    private readonly transport: DavTransport,
    baseUrl: string,
    auth: { username: string; password: string },
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.authorization = `Basic ${btoa(`${auth.username}:${auth.password}`)}`;
  }

  private async send(op: string, target: string, req: Omit<DavRequest, "headers"> & { headers?: Record<string, string> }): Promise<DavResponse> {
    const res = await this.transport({
      ...req,
      headers: { Authorization: this.authorization, ...req.headers },
    });
    if (res.status === 207 || (res.status >= 200 && res.status < 300)) return res;
    throw new DavError(res.status, op, target);
  }

  private async propfind(op: string, target: string, url: string, depth: 0 | 1): Promise<ParsedResponse[]> {
    // No body: RFC 4918 treats an empty PROPFIND as allprop, which every server understands.
    const res = await this.send(op, target, { url, method: "PROPFIND", headers: { Depth: String(depth) } });
    // Strictly require 207: a plain 200 (an HTML page, a non-DAV endpoint) would otherwise parse as
    // an empty multistatus and read as "server with zero projects" instead of a config error.
    if (res.status !== 207) {
      throw new Error(`${target}: not a WebDAV server (expected a 207 multistatus, got HTTP ${res.status})`);
    }
    return parseMultistatus(new TextDecoder().decode(res.body));
  }

  /** Whether a multistatus href refers to the PROPFIND target itself (the "self" response).
   *  Hrefs may be absolute URLs or server-absolute paths; compare normalized path equality. */
  private static isSelf(href: string, requestPath: string): boolean {
    const norm = (s: string): string => {
      const path = /^https?:\/\//.test(s) ? new URL(s).pathname : s;
      const stripped = decodeURIComponent(path.split("?")[0]!).replace(/\/+$/, "");
      return stripped === "" ? "/" : stripped;
    };
    return norm(href) === norm(requestPath);
  }

  private projectUrl(project: string): string {
    return `${this.base}/${encodeURIComponent(project)}/`;
  }

  private fileUrl(project: string, name: string): string {
    return `${this.base}/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;
  }

  async listProjects(): Promise<string[]> {
    const responses = await this.propfind("list projects", this.base, `${this.base}/`, 1);
    return responses
      .filter((r) => r.collection && !DavClient.isSelf(r.href, new URL(`${this.base}/`).pathname))
      .map((r) => hrefName(r.href))
      .filter((n) => n.length > 0);
  }

  async listFiles(project: string): Promise<RemoteEntry[]> {
    const responses = await this.propfind(`list files`, project, this.projectUrl(project), 1);
    return responses
      .filter((r) => !r.collection)
      .map((r) => ({ name: hrefName(r.href), etag: r.etag, size: r.size }));
  }

  async statFile(project: string, name: string): Promise<RemoteEntry> {
    const responses = await this.propfind("stat", `${project}/${name}`, this.fileUrl(project, name), 0);
    const r = responses.find((x) => !x.collection);
    if (!r) throw new DavError(404, "stat", `${project}/${name}`);
    return { name: hrefName(r.href), etag: r.etag, size: r.size };
  }

  async getFile(project: string, name: string): Promise<Uint8Array> {
    const res = await this.send("download", `${project}/${name}`, { url: this.fileUrl(project, name), method: "GET" });
    return res.body;
  }

  /** PUT with the given precondition; resolves the file's NEW etag (header, or stat fallback). */
  async putFile(project: string, name: string, data: Uint8Array, precond: PutPrecondition): Promise<string> {
    const headers: Record<string, string> = {};
    if (precond && "ifMatch" in precond) headers["If-Match"] = `"${precond.ifMatch}"`;
    if (precond && "ifNoneMatch" in precond) headers["If-None-Match"] = "*";
    const res = await this.send("upload", `${project}/${name}`, {
      url: this.fileUrl(project, name),
      method: "PUT",
      headers,
      body: data,
    });
    const header = res.headers.etag;
    if (header) return bareEtag(header);
    return (await this.statFile(project, name)).etag;
  }
}
