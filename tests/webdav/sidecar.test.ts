import { describe, expect, it } from "vitest";
import { SIDECAR_FILE, loadSidecar, parseSidecar, saveSidecar, type SidecarIo } from "../../src/remote/sidecar";
import type { Sidecar } from "../../src/remote/sync";

function memIo(): SidecarIo & { store: Map<string, Uint8Array>; writes: string[]; renames: [string, string][] } {
  const store = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const renames: [string, string][] = [];
  return {
    store, writes, renames,
    read: (p) => {
      const v = store.get(p);
      if (!v) return Promise.reject(new Error(`ENOENT ${p}`));
      return Promise.resolve(v);
    },
    write: (p, data) => {
      writes.push(p);
      store.set(p, data);
      return Promise.resolve();
    },
    exists: (p) => Promise.resolve(store.has(p)),
    rename: (from, to) => {
      renames.push([from, to]);
      const v = store.get(from);
      if (!v) return Promise.reject(new Error(`ENOENT ${from}`));
      store.delete(from);
      store.set(to, v);
      return Promise.resolve();
    },
  };
}

const SAMPLE: Sidecar = {
  serverId: "srv1",
  projectPath: "zarha",
  lastPull: "2026-07-07T12:00:00.000Z",
  files: { "a.lmb": { etag: "e1", size: 3, sha256: "h1" } },
};

describe("sidecar", () => {
  it("round-trips through save + load", async () => {
    const io = memIo();
    await saveSidecar(io, "/proj", SAMPLE);
    expect(await loadSidecar(io, "/proj")).toEqual(SAMPLE);
  });

  it("returns null when no sidecar exists", async () => {
    expect(await loadSidecar(memIo(), "/proj")).toBeNull();
  });

  it("returns 'corrupt' (not a throw) on garbage or wrong shape", async () => {
    const io = memIo();
    io.store.set(`/proj/${SIDECAR_FILE}`, new TextEncoder().encode("{nope"));
    expect(await loadSidecar(io, "/proj")).toBe("corrupt");
    io.store.set(`/proj/${SIDECAR_FILE}`, new TextEncoder().encode(JSON.stringify({ serverId: 5 })));
    expect(await loadSidecar(io, "/proj")).toBe("corrupt");
  });

  it("saves atomically: writes a .tmp then renames onto the real name", async () => {
    const io = memIo();
    await saveSidecar(io, "/proj", SAMPLE);
    expect(io.writes).toEqual([`/proj/${SIDECAR_FILE}.tmp`]);
    expect(io.renames).toEqual([[`/proj/${SIDECAR_FILE}.tmp`, `/proj/${SIDECAR_FILE}`]]);
  });

  it("parseSidecar throws on malformed input (loadSidecar owns the soft path)", () => {
    expect(() => parseSidecar("{}")).toThrow();
    expect(parseSidecar(JSON.stringify(SAMPLE))).toEqual(SAMPLE);
  });
});
