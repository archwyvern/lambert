import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type FixtureHandle } from "./fixtureServer";

const AUTH = { Authorization: `Basic ${Buffer.from("u:p").toString("base64")}` };

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), "dav-"));
  mkdirSync(join(root, "proj1"));
  writeFileSync(join(root, "proj1", "a.png"), Buffer.from([1, 2, 3]));
  writeFileSync(join(root, "proj1", "b.lmb"), "doc");
  return root;
}

describe("fixture WebDAV server (sha256 etags)", () => {
  let fx: FixtureHandle;
  beforeAll(async () => {
    fx = await startFixture({ root: seed(), username: "u", password: "p", etagMode: "sha256" });
  });
  afterAll(() => fx.close());

  it("lists projects as collections at the root", async () => {
    const res = await fetch(fx.url, { method: "PROPFIND", headers: { ...AUTH, Depth: "1" } });
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body).toContain("<D:collection/>");
    expect(body).toContain("proj1");
  });

  it("lists project files with size and sha256 etag", async () => {
    const res = await fetch(`${fx.url}proj1/`, { method: "PROPFIND", headers: { ...AUTH, Depth: "1" } });
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body).toContain("a.png");
    expect(body).toContain("b.lmb");
    expect(body).toContain("<D:getcontentlength>3</D:getcontentlength>");
    const sha = createHash("sha256").update(Buffer.from([1, 2, 3])).digest("hex");
    expect(body).toContain(`"${sha}"`);
  });

  it("PROPFIND depth 0 on a file returns exactly one response", async () => {
    const res = await fetch(`${fx.url}proj1/a.png`, { method: "PROPFIND", headers: { ...AUTH, Depth: "0" } });
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body.match(/<D:response>/g)).toHaveLength(1);
    expect(body).toContain("a.png");
  });

  it("GET returns bytes; missing file 404s", async () => {
    const ok = await fetch(`${fx.url}proj1/a.png`, { headers: AUTH });
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const missing = await fetch(`${fx.url}proj1/missing`, { headers: AUTH });
    expect(missing.status).toBe(404);
  });

  it("PUT If-None-Match:* creates once, then 412s", async () => {
    const first = await fetch(`${fx.url}proj1/new.lmb`, {
      method: "PUT", headers: { ...AUTH, "If-None-Match": "*" }, body: "x",
    });
    expect(first.status).toBe(201);
    expect(first.headers.get("etag")).toBeTruthy();
    const second = await fetch(`${fx.url}proj1/new.lmb`, {
      method: "PUT", headers: { ...AUTH, "If-None-Match": "*" }, body: "y",
    });
    expect(second.status).toBe(412);
  });

  it("PUT If-Match replaces only at the current etag", async () => {
    const stat = await fetch(`${fx.url}proj1/b.lmb`, { method: "PROPFIND", headers: { ...AUTH, Depth: "0" } });
    const etag = /<D:getetag>"([^"]+)"<\/D:getetag>/.exec(await stat.text())![1]!;
    const stale = await fetch(`${fx.url}proj1/b.lmb`, {
      method: "PUT", headers: { ...AUTH, "If-Match": '"stale"' }, body: "z",
    });
    expect(stale.status).toBe(412);
    const good = await fetch(`${fx.url}proj1/b.lmb`, {
      method: "PUT", headers: { ...AUTH, "If-Match": `"${etag}"` }, body: "z",
    });
    expect([200, 204]).toContain(good.status);
    expect(good.headers.get("etag")).not.toBe(`"${etag}"`);
  });

  it("rejects bad auth and unsupported verbs", async () => {
    const noAuth = await fetch(`${fx.url}proj1/a.png`);
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get("www-authenticate")).toContain("Basic");
    const del = await fetch(`${fx.url}proj1/a.png`, { method: "DELETE", headers: AUTH });
    expect(del.status).toBe(405);
  });

  it("failNext fails exactly one request", async () => {
    fx.failNext(500);
    const fail = await fetch(`${fx.url}proj1/a.png`, { headers: AUTH });
    expect(fail.status).toBe(500);
    const ok = await fetch(`${fx.url}proj1/a.png`, { headers: AUTH });
    expect(ok.status).toBe(200);
  });

  it("omitPutEtag drops the ETag response header", async () => {
    fx.omitPutEtag(true);
    const res = await fetch(`${fx.url}proj1/c.lmb`, {
      method: "PUT", headers: { ...AUTH, "If-None-Match": "*" }, body: "c",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("etag")).toBeNull();
    fx.omitPutEtag(false);
  });
});

describe("fixture WebDAV server (opaque etags)", () => {
  let fx: FixtureHandle;
  beforeAll(async () => {
    fx = await startFixture({ root: seed(), username: "u", password: "p", etagMode: "opaque" });
  });
  afterAll(() => fx.close());

  it("etags are stable across reads and change on writes", async () => {
    const read = async (): Promise<string> => {
      const res = await fetch(`${fx.url}proj1/b.lmb`, { method: "PROPFIND", headers: { ...AUTH, Depth: "0" } });
      return /<D:getetag>"([^"]+)"<\/D:getetag>/.exec(await res.text())![1]!;
    };
    const before = await read();
    expect(await read()).toBe(before);
    const put = await fetch(`${fx.url}proj1/b.lmb`, {
      method: "PUT", headers: { ...AUTH, "If-Match": `"${before}"` }, body: "changed",
    });
    expect([200, 204]).toContain(put.status);
    expect(await read()).not.toBe(before);
  });
});
