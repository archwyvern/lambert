import { describe, expect, it, vi } from "vitest";
import {
  parseSourceUri,
  fileUri,
  isRemote,
  defaultDocName,
  resolveDiffuse,
  type DiffuseHost,
} from "../../src/document/diffuseSource";

describe("parseSourceUri", () => {
  it("file uri -> absolute path", () => {
    expect(parseSourceUri("file:///art/a.png")).toEqual({ scheme: "file", value: "/art/a.png" });
  });
  it("http uri -> full url", () => {
    expect(parseSourceUri("http://x/a.png")).toEqual({ scheme: "http", value: "http://x/a.png" });
  });
  it("https uri -> full url", () => {
    expect(parseSourceUri("https://x/a.png")).toEqual({ scheme: "https", value: "https://x/a.png" });
  });
  it("throws on an unknown scheme", () => expect(() => parseSourceUri("ftp://x/a")).toThrow());
  it("throws on a bare path (no scheme)", () => expect(() => parseSourceUri("/just/a/path")).toThrow());
});

it("fileUri round-trips through parseSourceUri (spaces survive)", () => {
  expect(parseSourceUri(fileUri("/art/my ship.df.png"))).toEqual({ scheme: "file", value: "/art/my ship.df.png" });
});

it("isRemote distinguishes http(s) from file", () => {
  expect(isRemote("https://x/a.png")).toBe(true);
  expect(isRemote("http://x/a.png")).toBe(true);
  expect(isRemote("file:///a.png")).toBe(false);
});

describe("defaultDocName", () => {
  it("strips .df.png and adds .lmb", () => {
    expect(defaultDocName("file:///art/6powercoil.df.png")).toBe("6powercoil.lmb");
  });
  it("strips a plain .png", () => expect(defaultDocName("https://x/y/hull.png")).toBe("hull.lmb"));
  it("ignores a query string", () => expect(defaultDocName("https://x/y/hull.png?v=2")).toBe("hull.lmb"));
});

describe("resolveDiffuse", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  it("file -> host.readFile(path)", async () => {
    const host: DiffuseHost = { readFile: vi.fn().mockResolvedValue(bytes), fetchUrl: vi.fn() };
    await expect(resolveDiffuse(host, "file:///a.png")).resolves.toBe(bytes);
    expect(host.readFile).toHaveBeenCalledWith("/a.png");
    expect(host.fetchUrl).not.toHaveBeenCalled();
  });
  it("http -> host.fetchUrl(url)", async () => {
    const host: DiffuseHost = { readFile: vi.fn(), fetchUrl: vi.fn().mockResolvedValue(bytes) };
    await expect(resolveDiffuse(host, "http://x/a.png")).resolves.toBe(bytes);
    expect(host.fetchUrl).toHaveBeenCalledWith("http://x/a.png", undefined);
  });
  it("forwards the refresh flag", async () => {
    const host: DiffuseHost = { readFile: vi.fn(), fetchUrl: vi.fn().mockResolvedValue(bytes) };
    await resolveDiffuse(host, "https://x/a.png", { refresh: true });
    expect(host.fetchUrl).toHaveBeenCalledWith("https://x/a.png", { refresh: true });
  });
  it("throws on an unknown scheme", async () => {
    const host: DiffuseHost = { readFile: vi.fn(), fetchUrl: vi.fn() };
    await expect(resolveDiffuse(host, "ftp://x/a")).rejects.toThrow();
  });
});
