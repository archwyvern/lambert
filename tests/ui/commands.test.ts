import { describe, expect, it } from "vitest";
import { migrateLegacyOverrides } from "../../src/ui/commands";

describe("migrateLegacyOverrides", () => {
  it("renames a legacy settings override to preferences", () => {
    expect(migrateLegacyOverrides({ settings: "Ctrl+Shift+," })).toEqual({ preferences: "Ctrl+Shift+," });
  });

  it("returns the same reference when there is nothing to migrate", () => {
    const prev = { save: "Ctrl+S" };
    expect(migrateLegacyOverrides(prev)).toBe(prev);
  });

  it("drops the legacy id when preferences already has an override", () => {
    expect(migrateLegacyOverrides({ settings: "Ctrl+1", preferences: "Ctrl+2" })).toEqual({ preferences: "Ctrl+2" });
  });

  it("carries an explicit unbind (null) across the rename", () => {
    expect(migrateLegacyOverrides({ settings: null })).toEqual({ preferences: null });
  });
});
