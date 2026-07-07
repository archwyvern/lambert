import { describe, expect, it } from "vitest";
import { planPull, planPush, sha256Hex, type LocalFile, type Sidecar } from "../../src/remote/sync";
import type { RemoteEntry } from "../../src/remote/dav";

const sidecar = (files: Sidecar["files"]): Sidecar => ({
  serverId: "srv", baseUrl: "http://dav.test/", projectPath: "proj", lastPull: "2026-07-07T00:00:00Z", files,
});
const remote = (name: string, etag: string): RemoteEntry => ({ name, etag, size: 1 });
const local = (name: string, sha256: string): LocalFile => ({ name, sha256 });
const rec = (etag: string, sha256: string): { etag: string; size: number; sha256: string } => ({ etag, size: 1, sha256 });

describe("planPull matrix", () => {
  it("no local file: download (covers new remote files AND locally deleted ones)", () => {
    expect(planPull([remote("a.lmb", "e1")], [], sidecar({}))).toEqual([{ name: "a.lmb", kind: "download" }]);
    expect(planPull([remote("a.lmb", "e1")], [], sidecar({ "a.lmb": rec("e1", "h1") }))).toEqual([
      { name: "a.lmb", kind: "download" },
    ]);
  });

  it("unmodified both sides: skip", () => {
    expect(planPull([remote("a.lmb", "e1")], [local("a.lmb", "h1")], sidecar({ "a.lmb": rec("e1", "h1") }))).toEqual([
      { name: "a.lmb", kind: "skip" },
    ]);
  });

  it("remote changed, local untouched: fast-forward", () => {
    expect(planPull([remote("a.lmb", "e2")], [local("a.lmb", "h1")], sidecar({ "a.lmb": rec("e1", "h1") }))).toEqual([
      { name: "a.lmb", kind: "fast-forward" },
    ]);
  });

  it("local modified, remote unchanged: keep-local", () => {
    expect(planPull([remote("a.lmb", "e1")], [local("a.lmb", "h2")], sidecar({ "a.lmb": rec("e1", "h1") }))).toEqual([
      { name: "a.lmb", kind: "keep-local" },
    ]);
  });

  it("both changed: conflict", () => {
    expect(planPull([remote("a.lmb", "e2")], [local("a.lmb", "h2")], sidecar({ "a.lmb": rec("e1", "h1") }))).toEqual([
      { name: "a.lmb", kind: "conflict" },
    ]);
  });

  it("no record but local file exists (hand-copied stranger): conflict", () => {
    expect(planPull([remote("a.lmb", "e1")], [local("a.lmb", "h1")], sidecar({}))).toEqual([
      { name: "a.lmb", kind: "conflict" },
    ]);
  });

  it("mixed listing keeps per-file independence", () => {
    const plan = planPull(
      [remote("new.png", "e9"), remote("same.lmb", "e1"), remote("ff.lmb", "e2")],
      [local("same.lmb", "h1"), local("ff.lmb", "hf")],
      sidecar({ "same.lmb": rec("e1", "h1"), "ff.lmb": rec("e1", "hf") }),
    );
    expect(plan).toEqual([
      { name: "new.png", kind: "download" },
      { name: "same.lmb", kind: "skip" },
      { name: "ff.lmb", kind: "fast-forward" },
    ]);
  });
});

describe("planPush matrix", () => {
  it("no record: create", () => {
    expect(planPush([local("a.lmb", "h1")], sidecar({}))).toEqual([{ name: "a.lmb", kind: "create" }]);
  });

  it("unchanged content: skip", () => {
    expect(planPush([local("a.lmb", "h1")], sidecar({ "a.lmb": rec("e1", "h1") }))).toEqual([
      { name: "a.lmb", kind: "skip" },
    ]);
  });

  it("changed content: update carrying the RECORDED etag as If-Match", () => {
    expect(planPush([local("a.lmb", "h2")], sidecar({ "a.lmb": rec("e1", "h1") }))).toEqual([
      { name: "a.lmb", kind: "update", ifMatch: "e1" },
    ]);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
