import { describe, it, expect } from "vitest";
import { initialUpdateState, reduceUpdate } from "../../src/ui/updateState";

const after = (...actions: Parameters<typeof reduceUpdate>[1][]) =>
  actions.reduce((s, a) => reduceUpdate(s, a), initialUpdateState);

describe("reduceUpdate", () => {
  it("an auto check that finds nothing stays silent (idle)", () => {
    expect(after({ type: "checking" }, { type: "not-available" }).phase).toBe("idle");
  });

  it("a manual check that finds nothing reports 'up to date'", () => {
    expect(after({ type: "check", manual: true }, { type: "not-available" }).phase).toBe("uptodate");
  });

  it("an available update always surfaces an offer with its version", () => {
    const s = after({ type: "available", version: "1.2.0" });
    expect(s.phase).toBe("available");
    expect(s.version).toBe("1.2.0");
  });

  it("download progress moves to downloading with a percent", () => {
    const s = after({ type: "available", version: "1.2.0" }, { type: "progress", percent: 42 });
    expect(s.phase).toBe("downloading");
    expect(s.percent).toBe(42);
  });

  it("a finished download offers a restart", () => {
    const s = after({ type: "downloaded", version: "1.2.0" });
    expect(s.phase).toBe("downloaded");
    expect(s.version).toBe("1.2.0");
  });

  it("an auto error stays silent, a manual error surfaces", () => {
    expect(after({ type: "error", message: "x" }).phase).toBe("idle");
    expect(after({ type: "check", manual: true }, { type: "error", message: "boom" }).phase).toBe("error");
  });

  it("an error while downloading surfaces (the user engaged)", () => {
    const s = after(
      { type: "available", version: "1.2.0" },
      { type: "progress", percent: 10 },
      { type: "error", message: "net" },
    );
    expect(s.phase).toBe("error");
  });

  it("clicking Download shows a pending state before any progress arrives", () => {
    const s = after({ type: "available", version: "1.2.0" }, { type: "download" });
    expect(s.phase).toBe("downloading");
    expect(s.percent).toBe(0);
    expect(s.version).toBe("1.2.0");
  });

  it("a download that fails before any progress still surfaces (auto-detected update, the 404 bug)", () => {
    // Regression: an AUTO check (manual:false) found an update; the user clicks Download; the download
    // 404s before a single progress event. Without the "download" action pinning phase=downloading, the
    // error case fell through to idle and the banner vanished ("clicked Download, nothing happened").
    const s = after(
      { type: "available", version: "1.2.0" },
      { type: "download" },
      { type: "error", message: "404" },
    );
    expect(s.phase).toBe("error");
    expect(s.message).toBe("404");
  });

  it("dismiss returns to idle", () => {
    expect(after({ type: "check", manual: true }, { type: "not-available" }, { type: "dismiss" }).phase).toBe("idle");
  });
});
