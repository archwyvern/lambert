import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Zero-dependency fixture WebDAV server — the reference implementation of the exact subset
 * lambert's remote-projects client requires (see docs: README "Remote projects"). Serves a root
 * directory whose child directories are projects and whose files are the project assets.
 *
 * Deliberately supports two etag modes: "sha256" mirrors the skyrat facade (etag = content hash),
 * "opaque" mirrors generic servers (mtime+size validator) — the client must work with both.
 * Fault injection (failNext / omitPutEtag) exists so failure paths get real tests.
 */
export interface FixtureOptions {
  root: string;
  username: string;
  password: string;
  etagMode: "sha256" | "opaque";
  /** Fixed port for the standalone serve script; tests omit it (ephemeral). */
  port?: number;
}

export interface FixtureHandle {
  url: string;
  close(): Promise<void>;
  /** The next request (any verb) returns this status with an empty body. */
  failNext(status: number): void;
  /** While on, PUT responses omit the ETag header (client must fall back to PROPFIND). */
  omitPutEtag(on: boolean): void;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function responseXml(
  href: string,
  opts: { collection: boolean; name: string; size?: number; etag?: string; mtime?: Date },
): string {
  const props = opts.collection
    ? `<D:resourcetype><D:collection/></D:resourcetype><D:displayname>${xmlEscape(opts.name)}</D:displayname>`
    : `<D:resourcetype/><D:displayname>${xmlEscape(opts.name)}</D:displayname>` +
      `<D:getcontentlength>${opts.size}</D:getcontentlength>` +
      `<D:getetag>"${opts.etag}"</D:getetag>` +
      `<D:getlastmodified>${opts.mtime!.toUTCString()}</D:getlastmodified>`;
  return (
    `<D:response><D:href>${xmlEscape(href)}</D:href><D:propstat><D:prop>${props}</D:prop>` +
    `<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
  );
}

function multistatus(responses: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${responses.join("")}</D:multistatus>`;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function startFixture(opts: FixtureOptions): Promise<FixtureHandle> {
  let failStatus: number | null = null;
  let noPutEtag = false;

  const etagOf = async (path: string): Promise<string> => {
    if (opts.etagMode === "sha256") {
      return createHash("sha256").update(await readFile(path)).digest("hex");
    }
    const st = await stat(path);
    return `op-${st.mtimeMs}-${st.size}`;
  };

  /** Decode + validate the URL into path segments (max 2: project / file). Throws on escapes. */
  const segmentsOf = (url: string): string[] => {
    const segs = url.split("?")[0]!.split("/").filter(Boolean).map(decodeURIComponent);
    if (segs.some((s) => s === ".." || s.includes("/"))) throw new Error("bad path");
    return segs;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const expected = `Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString("base64")}`;
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="dav"' });
      return void res.end();
    }
    if (failStatus !== null) {
      const status = failStatus;
      failStatus = null;
      res.writeHead(status);
      return void res.end();
    }

    let segs: string[];
    try {
      segs = segmentsOf(req.url ?? "/");
    } catch {
      res.writeHead(400);
      return void res.end();
    }

    if (req.method === "PROPFIND") {
      const depth = req.headers.depth === "0" ? 0 : 1;
      await readBody(req); // body ignored: empty body/allprop and named-prop requests get the same set
      const responses: string[] = [];
      if (segs.length === 0) {
        responses.push(responseXml("/", { collection: true, name: "" }));
        if (depth === 1) {
          for (const e of await readdir(opts.root, { withFileTypes: true })) {
            if (e.isDirectory()) responses.push(responseXml(`/${encodeURIComponent(e.name)}/`, { collection: true, name: e.name }));
          }
        }
      } else if (segs.length === 1) {
        const dir = join(opts.root, segs[0]!);
        try {
          if (!(await stat(dir)).isDirectory()) throw new Error("not a dir");
        } catch {
          res.writeHead(404);
          return void res.end();
        }
        responses.push(responseXml(`/${encodeURIComponent(segs[0]!)}/`, { collection: true, name: segs[0]! }));
        if (depth === 1) {
          for (const e of await readdir(dir, { withFileTypes: true })) {
            if (!e.isFile()) continue;
            const p = join(dir, e.name);
            const st = await stat(p);
            responses.push(
              responseXml(`/${encodeURIComponent(segs[0]!)}/${encodeURIComponent(e.name)}`, {
                collection: false, name: e.name, size: st.size, etag: await etagOf(p), mtime: st.mtime,
              }),
            );
          }
        }
      } else {
        const p = join(opts.root, segs[0]!, segs[1]!);
        let st;
        try {
          st = await stat(p);
        } catch {
          res.writeHead(404);
          return void res.end();
        }
        responses.push(
          responseXml(`/${encodeURIComponent(segs[0]!)}/${encodeURIComponent(segs[1]!)}`, {
            collection: false, name: segs[1]!, size: st.size, etag: await etagOf(p), mtime: st.mtime,
          }),
        );
      }
      const body = multistatus(responses);
      res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' });
      return void res.end(body);
    }

    if (req.method === "GET" && segs.length === 2) {
      try {
        const bytes = await readFile(join(opts.root, segs[0]!, segs[1]!));
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
        return void res.end(bytes);
      } catch {
        res.writeHead(404);
        return void res.end();
      }
    }

    if (req.method === "PUT" && segs.length === 2) {
      const p = join(opts.root, segs[0]!, segs[1]!);
      try {
        if (!(await stat(join(opts.root, segs[0]!))).isDirectory()) throw new Error("no project");
      } catch {
        res.writeHead(404);
        return void res.end();
      }
      const body = await readBody(req);
      const exists = await stat(p).then(() => true, () => false);
      const ifNoneMatch = req.headers["if-none-match"];
      const ifMatch = req.headers["if-match"];
      if (ifNoneMatch === "*" && exists) {
        res.writeHead(412);
        return void res.end();
      }
      if (typeof ifMatch === "string") {
        const want = ifMatch.replace(/^W\//, "").replace(/^"|"$/g, "");
        if (!exists || (await etagOf(p)) !== want) {
          res.writeHead(412);
          return void res.end();
        }
      }
      await writeFile(p, body);
      const headers: Record<string, string> = {};
      if (!noPutEtag) headers.ETag = `"${await etagOf(p)}"`;
      res.writeHead(exists ? 204 : 201, headers);
      return void res.end();
    }

    res.writeHead(405, { Allow: "PROPFIND, GET, PUT" });
    res.end();
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("fixture failed to bind");
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    failNext: (status) => { failStatus = status; },
    omitPutEtag: (on) => { noPutEtag = on; },
  };
}
