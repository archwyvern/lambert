import { describe, expect, it, vi } from "vitest";
import {
  parseSourceUri,
  fileUri,
  isRemote,
  defaultDocName,
  resolveDiffuse,
  relativizeSourceUri,
  healDiffuse,
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

// ── project-relative sources (portable .lmb: the diffuse lives inside the project) ──

describe("relative source URIs", () => {
  it("a bare relative path parses as scheme relative", () => {
    expect(parseSourceUri("armor.df.png")).toEqual({ scheme: "relative", value: "armor.df.png" });
    expect(parseSourceUri("textures/panel.df.png")).toEqual({ scheme: "relative", value: "textures/panel.df.png" });
  });
  it("a ./ prefix is normalized away", () => {
    expect(parseSourceUri("./armor.df.png")).toEqual({ scheme: "relative", value: "armor.df.png" });
  });
  it("absolute bare paths still throw (they must wear file://)", () => {
    expect(() => parseSourceUri("/just/a/path")).toThrow();
    expect(() => parseSourceUri("C:\\art\\a.png")).toThrow();
  });
  it("parent escapes are rejected", () => {
    expect(() => parseSourceUri("../outside.png")).toThrow();
  });

  it("resolveDiffuse joins a relative value onto baseDir", async () => {
    const bytes = new Uint8Array([7]);
    const host: DiffuseHost = { readFile: vi.fn(async () => bytes), fetchUrl: vi.fn() };
    await expect(resolveDiffuse(host, "textures/panel.df.png", { baseDir: "/proj" })).resolves.toBe(bytes);
    expect(host.readFile).toHaveBeenCalledWith("/proj/textures/panel.df.png");
  });
  it("resolveDiffuse rejects a relative uri with no baseDir", async () => {
    const host: DiffuseHost = { readFile: vi.fn(), fetchUrl: vi.fn() };
    await expect(resolveDiffuse(host, "armor.df.png")).rejects.toThrow(/baseDir|project/i);
  });

  it("isRemote is false for relative", () => expect(isRemote("armor.df.png")).toBe(false));
  it("defaultDocName works on relative sources", () => {
    expect(defaultDocName("textures/panel.df.png")).toBe("panel.lmb");
  });
});

describe("relativizeSourceUri", () => {
  it("a file uri inside the project becomes relative", () => {
    expect(relativizeSourceUri("file:///proj/armor.df.png", "/proj")).toBe("armor.df.png");
    expect(relativizeSourceUri("file:///proj/textures/panel.df.png", "/proj")).toBe("textures/panel.df.png");
  });
  it("outside the project stays absolute", () => {
    expect(relativizeSourceUri("file:///elsewhere/a.png", "/proj")).toBe("file:///elsewhere/a.png");
  });
  it("a lookalike prefix is NOT inside (/proj2 vs /proj)", () => {
    expect(relativizeSourceUri("file:///proj2/a.png", "/proj")).toBe("file:///proj2/a.png");
  });
  it("http and already-relative pass through", () => {
    expect(relativizeSourceUri("https://x/a.png", "/proj")).toBe("https://x/a.png");
    expect(relativizeSourceUri("armor.df.png", "/proj")).toBe("armor.df.png");
  });
});

describe("healDiffuse", () => {
  const files: Record<string, Uint8Array> = {
    "/clone/armor.df.png": new Uint8Array([1]),
    "/clone/textures/panel.df.png": new Uint8Array([2]),
  };
  const host: DiffuseHost = {
    readFile: async (p) => {
      const b = files[p];
      if (!b) throw new Error("ENOENT");
      return b;
    },
    fetchUrl: vi.fn(),
  };

  it("re-anchors a dead absolute path by its longest suffix under the project", async () => {
    const healed = await healDiffuse(host, "file:///old/machine/textures/panel.df.png", "/clone");
    expect(healed).toEqual({ uri: "textures/panel.df.png", bytes: files["/clone/textures/panel.df.png"] });
  });
  it("falls back to the basename", async () => {
    const healed = await healDiffuse(host, "file:///somewhere/else/armor.df.png", "/clone");
    expect(healed).toEqual({ uri: "armor.df.png", bytes: files["/clone/armor.df.png"] });
  });
  it("returns null when nothing matches", async () => {
    expect(await healDiffuse(host, "file:///gone/nothere.png", "/clone")).toBeNull();
  });
  it("never heals http(s) or relative sources", async () => {
    expect(await healDiffuse(host, "https://x/a.png", "/clone")).toBeNull();
    expect(await healDiffuse(host, "armor.df.png", "/clone")).toBeNull();
  });
});
