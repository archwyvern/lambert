// @vitest-environment jsdom
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type FixtureHandle } from "./fixtureServer";
import { DavClient, DavError, type DavTransport } from "../../src/remote/dav";

const fetchTransport: DavTransport = async (req) => {
  // cast: TS's BodyInit wants Uint8Array<ArrayBuffer>; ours is ArrayBufferLike (same bytes at runtime)
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body as BodyInit | undefined });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) };
};

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), "davc-"));
  mkdirSync(join(root, "proj one")); // space: exercises URL encoding
  writeFileSync(join(root, "proj one", "a.png"), Buffer.from([9, 8, 7]));
  writeFileSync(join(root, "proj one", "b file.lmb"), "doc");
  mkdirSync(join(root, "empty"));
  return root;
}

function clientFor(fx: FixtureHandle, password = "p"): DavClient {
  return new DavClient(fetchTransport, fx.url, { Authorization: `Basic ${btoa(`u:${password}`)}` });
}

describe("DavClient against sha256 fixture", () => {
  let fx: FixtureHandle;
  beforeAll(async () => {
    fx = await startFixture({ root: seed(), username: "u", password: "p", etagMode: "sha256" });
  });
  afterAll(() => fx.close());

  it("lists projects excluding the base collection itself", async () => {
    expect((await clientFor(fx).listProjects()).sort()).toEqual(["empty", "proj one"]);
  });

  it("lists files with decoded names, sizes, unquoted etags", async () => {
    const files = await clientFor(fx).listFiles("proj one");
    const png = files.find((f) => f.name === "a.png")!;
    const lmb = files.find((f) => f.name === "b file.lmb")!;
    expect(files).toHaveLength(2);
    expect(png.size).toBe(3);
    expect(png.etag).not.toContain('"');
    expect(lmb.name).toBe("b file.lmb");
  });

  it("statFile matches the listing entry", async () => {
    const c = clientFor(fx);
    const listed = (await c.listFiles("proj one")).find((f) => f.name === "a.png")!;
    expect(await c.statFile("proj one", "a.png")).toEqual(listed);
  });

  it("getFile round-trips bytes", async () => {
    expect(Array.from(await clientFor(fx).getFile("proj one", "a.png"))).toEqual([9, 8, 7]);
  });

  it("putFile creates with If-None-Match and the etag appears in the listing", async () => {
    const c = clientFor(fx);
    const etag = await c.putFile("proj one", "new.lmb", new TextEncoder().encode("x"), { ifNoneMatch: true });
    expect(etag).toBeTruthy();
    const listed = (await c.listFiles("proj one")).find((f) => f.name === "new.lmb")!;
    expect(listed.etag).toBe(etag);
  });

  it("putFile with a stale If-Match rejects with DavError 412", async () => {
    const err = await clientFor(fx)
      .putFile("proj one", "a.png", new Uint8Array([0]), { ifMatch: "stale" })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(DavError);
    expect((err as DavError).status).toBe(412);
  });

  it("putFile resolves the etag via statFile when the server omits the ETag header", async () => {
    const c = clientFor(fx);
    fx.omitPutEtag(true);
    const etag = await c.putFile("proj one", "omitted.lmb", new TextEncoder().encode("q"), { ifNoneMatch: true });
    fx.omitPutEtag(false);
    expect(etag).toBe((await c.statFile("proj one", "omitted.lmb")).etag);
  });

  it("wrong credentials surface as DavError 401", async () => {
    const err = await clientFor(fx, "wrong").listProjects().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(DavError);
    expect((err as DavError).status).toBe(401);
  });

  it("authenticates via a custom API-key header instead of Basic", async () => {
    const keyed = await startFixture({
      root: seed(), username: "u", password: "p",
      apiHeader: { name: "X-Skyrat-Api-Key", value: "sekrit" },
      etagMode: "sha256",
    });
    try {
      const good = new DavClient(fetchTransport, keyed.url, { "X-Skyrat-Api-Key": "sekrit" });
      expect((await good.listProjects()).sort()).toEqual(["empty", "proj one"]);
      const bad = new DavClient(fetchTransport, keyed.url, { "X-Skyrat-Api-Key": "wrong" });
      const err = await bad.listProjects().then(() => null, (e: unknown) => e);
      expect((err as DavError).status).toBe(401);
    } finally {
      await keyed.close();
    }
  });

  it("server failures surface as DavError with the status", async () => {
    fx.failNext(500);
    const err = await clientFor(fx).getFile("proj one", "a.png").then(() => null, (e: unknown) => e);
    expect((err as DavError).status).toBe(500);
  });

  it("a 200 where a 207 belongs reads as 'not a WebDAV server', not as zero projects", async () => {
    fx.failNext(200, "PROPFIND"); // a non-DAV endpoint answering PROPFIND with a plain 200
    const err = await clientFor(fx).listProjects().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("not a WebDAV server");
  });
});

describe("DavClient against opaque-etag fixture", () => {
  let fx: FixtureHandle;
  beforeAll(async () => {
    fx = await startFixture({ root: seed(), username: "u", password: "p", etagMode: "opaque" });
  });
  afterAll(() => fx.close());

  it("full list/get/put cycle works with opaque validators", async () => {
    const c = clientFor(fx);
    const before = (await c.listFiles("proj one")).find((f) => f.name === "b file.lmb")!;
    // Array.from: jsdom + node Uint8Array are different realms; toEqual on the raw arrays is flaky
    expect(Array.from(await c.getFile("proj one", "b file.lmb"))).toEqual([100, 111, 99]);
    const newTag = await c.putFile("proj one", "b file.lmb", new TextEncoder().encode("doc2"), { ifMatch: before.etag });
    expect(newTag).not.toBe(before.etag);
    expect((await c.statFile("proj one", "b file.lmb")).etag).toBe(newTag);
  });
});
