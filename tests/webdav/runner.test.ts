// @vitest-environment jsdom
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFixture, type FixtureHandle } from "./fixtureServer";
import { DavClient, type DavTransport } from "../../src/remote/dav";
import { PUSH_FILTER, cloneProject, runPull, runPush, type LocalIo, type SyncUi } from "../../src/remote/runner";
import { sha256Hex, type Sidecar } from "../../src/remote/sync";

const fetchTransport: DavTransport = async (req) => {
  // cast: TS's BodyInit wants Uint8Array<ArrayBuffer>; ours is ArrayBufferLike (same bytes at runtime)
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body as BodyInit | undefined });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) };
};

function memLocal(): LocalIo & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    list: () => Promise.resolve(Array.from(store.keys())),
    read: (n) => {
      const v = store.get(n);
      return v ? Promise.resolve(v) : Promise.reject(new Error(`ENOENT ${n}`));
    },
    write: (n, d) => {
      store.set(n, d);
      return Promise.resolve();
    },
    exists: (n) => Promise.resolve(store.has(n)),
  };
}

function scriptedUi(overwriteAnswers: boolean[] = []): SyncUi & { messages: string[]; prompts: string[] } {
  const messages: string[] = [];
  const prompts: string[] = [];
  const answers = [...overwriteAnswers];
  return {
    messages, prompts,
    progress: (m, d, t) => { messages.push(`${m} ${d}/${t}`); },
    confirmOverwriteLocal: (name) => {
      prompts.push(name);
      return Promise.resolve(answers.shift() ?? false);
    },
    info: (m) => { messages.push(m); },
  };
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const asText = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("runners against the fixture", () => {
  let fx: FixtureHandle;
  let root: string;
  let dav: DavClient;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "davr-"));
    mkdirSync(join(root, "zarha"));
    writeFileSync(join(root, "zarha", "a.png"), Buffer.from([1, 2, 3]));
    writeFileSync(join(root, "zarha", "b.lmb"), "doc-b");
    writeFileSync(join(root, "zarha", "project.lambert"), "{}");
    fx = await startFixture({ root, username: "u", password: "p", etagMode: "sha256" });
    dav = new DavClient(fetchTransport, fx.url, { username: "u", password: "p" });
  });
  afterEach(() => fx.close());

  it("clone downloads everything and records etag+sha256 per file", async () => {
    const io = memLocal();
    const ui = scriptedUi();
    const { sidecar, failed } = await cloneProject(dav, "zarha", "srv1", io, ui);
    expect(failed).toEqual([]);
    expect(Array.from(io.store.keys()).sort()).toEqual(["a.png", "b.lmb", "project.lambert"]);
    expect(sidecar.serverId).toBe("srv1");
    expect(sidecar.projectPath).toBe("zarha");
    expect(sidecar.lastPull).not.toBe("");
    expect(sidecar.files["b.lmb"]!.sha256).toBe(await sha256Hex(text("doc-b")));
    expect(sidecar.files["a.png"]!.etag).toBe((await dav.listFiles("zarha")).find((f) => f.name === "a.png")!.etag);
    expect(ui.messages.some((m) => m.endsWith("3/3"))).toBe(true);
  });

  it("clone survives a failed download and reports it", async () => {
    const io = memLocal();
    fx.failNext(500, "GET"); // scoped to a download — the listing PROPFIND must succeed
    const { sidecar, failed } = await cloneProject(dav, "zarha", "srv1", io, scriptedUi());
    // one file failed (whichever hit the injected 500 after listFiles), the others landed
    expect(failed).toHaveLength(1);
    expect(io.store.size).toBe(2);
    expect(Object.keys(sidecar.files)).toHaveLength(2);
  });

  it("pull fast-forwards a remote change over an untouched local file, silently", async () => {
    const io = memLocal();
    const { sidecar } = await cloneProject(dav, "zarha", "srv1", io, scriptedUi());
    const current = (await dav.listFiles("zarha")).find((f) => f.name === "b.lmb")!;
    await dav.putFile("zarha", "b.lmb", text("doc-b-v2"), { ifMatch: current.etag });
    const ui = scriptedUi();
    const { sidecar: next, summary } = await runPull(dav, sidecar, io, ui);
    expect(asText(io.store.get("b.lmb")!)).toBe("doc-b-v2");
    expect(summary.fastForwarded).toEqual(["b.lmb"]);
    expect(ui.prompts).toEqual([]);
    expect(next.files["b.lmb"]!.sha256).toBe(await sha256Hex(text("doc-b-v2")));
  });

  it("pull conflict: overwrite answer replaces local; decline keeps it AND keeps the old record", async () => {
    const io = memLocal();
    const { sidecar } = await cloneProject(dav, "zarha", "srv1", io, scriptedUi());
    const current = (await dav.listFiles("zarha")).find((f) => f.name === "b.lmb")!;
    await dav.putFile("zarha", "b.lmb", text("remote-edit"), { ifMatch: current.etag });
    io.store.set("b.lmb", text("local-edit"));

    const decline = scriptedUi([false]);
    const declined = await runPull(dav, sidecar, io, decline);
    expect(asText(io.store.get("b.lmb")!)).toBe("local-edit");
    expect(declined.summary.conflictsKept).toEqual(["b.lmb"]);
    expect(declined.sidecar.files["b.lmb"]).toEqual(sidecar.files["b.lmb"]); // old record: re-prompts next pull

    const accept = scriptedUi([true]);
    const accepted = await runPull(dav, declined.sidecar, io, accept);
    expect(asText(io.store.get("b.lmb")!)).toBe("remote-edit");
    expect(accepted.summary.conflictsOverwritten).toEqual(["b.lmb"]);
    expect(accept.prompts).toEqual(["b.lmb"]);
  });

  it("pull restores a locally deleted file", async () => {
    const io = memLocal();
    const { sidecar } = await cloneProject(dav, "zarha", "srv1", io, scriptedUi());
    io.store.delete("b.lmb");
    const { summary } = await runPull(dav, sidecar, io, scriptedUi());
    expect(asText(io.store.get("b.lmb")!)).toBe("doc-b");
    expect(summary.downloaded).toEqual(["b.lmb"]);
  });

  it("push uploads changes with If-Match, creates new files, skips unchanged", async () => {
    const io = memLocal();
    const { sidecar } = await cloneProject(dav, "zarha", "srv1", io, scriptedUi());
    io.store.set("b.lmb", text("edited"));
    io.store.set("new.lmb", text("fresh"));
    const { sidecar: next, summary } = await runPush(dav, sidecar, io, scriptedUi());
    expect(summary.uploaded.sort()).toEqual(["b.lmb", "new.lmb"]);
    expect(summary.skipped).toEqual(["project.lambert"]);
    expect(asText(await dav.getFile("zarha", "b.lmb"))).toBe("edited");
    expect(asText(await dav.getFile("zarha", "new.lmb"))).toBe("fresh");
    expect(next.files["b.lmb"]!.sha256).toBe(await sha256Hex(text("edited")));
    expect(next.files["new.lmb"]!.etag).toBe((await dav.listFiles("zarha")).find((f) => f.name === "new.lmb")!.etag);
  });

  it("push blocks (412) when the remote moved since last pull, leaving the record untouched", async () => {
    const io = memLocal();
    const { sidecar } = await cloneProject(dav, "zarha", "srv1", io, scriptedUi());
    const current = (await dav.listFiles("zarha")).find((f) => f.name === "b.lmb")!;
    await dav.putFile("zarha", "b.lmb", text("someone-else"), { ifMatch: current.etag });
    io.store.set("b.lmb", text("mine"));
    const { sidecar: next, summary } = await runPush(dav, sidecar, io, scriptedUi());
    expect(summary.blocked).toEqual(["b.lmb"]);
    expect(summary.uploaded).toEqual([]);
    expect(asText(await dav.getFile("zarha", "b.lmb"))).toBe("someone-else");
    expect(next.files["b.lmb"]).toEqual(sidecar.files["b.lmb"]);
  });

  it("push records the correct etag even when the server omits ETag on PUT", async () => {
    const io = memLocal();
    const { sidecar } = await cloneProject(dav, "zarha", "srv1", io, scriptedUi());
    io.store.set("b.lmb", text("edited2"));
    fx.omitPutEtag(true);
    const { sidecar: next } = await runPush(dav, sidecar, io, scriptedUi());
    fx.omitPutEtag(false);
    expect(next.files["b.lmb"]!.etag).toBe((await dav.listFiles("zarha")).find((f) => f.name === "b.lmb")!.etag);
  });
});

describe("PUSH_FILTER", () => {
  it("accepts lmb (case-insensitive) + project.lambert, rejects everything else", () => {
    expect(PUSH_FILTER("a.lmb")).toBe(true);
    expect(PUSH_FILTER("A.LMB")).toBe(true);
    expect(PUSH_FILTER("project.lambert")).toBe(true);
    expect(PUSH_FILTER("a.png")).toBe(false);
    expect(PUSH_FILTER(".lambert-remote.json")).toBe(false);
    expect(PUSH_FILTER(".lambert-remote.json.tmp")).toBe(false);
  });
});
