import { describe, expect, it } from "vitest";
import { SETTINGS_DEFAULT_SCREEN, settingsDialogFor } from "../../src/ui/settingsRouting";

describe("settingsDialogFor", () => {
  it("routes app screens to preferences", () => {
    expect(settingsDialogFor("app-shortcuts")).toBe("prefs");
    expect(settingsDialogFor("app-updates")).toBe("prefs");
    expect(settingsDialogFor("app-remotes")).toBe("prefs");
  });

  it("routes doc screens to document settings", () => {
    expect(settingsDialogFor("doc-canvas")).toBe("doc");
    expect(settingsDialogFor("doc-normals")).toBe("doc");
    expect(settingsDialogFor("doc-output")).toBe("doc");
  });

  it("routes project screens to project settings", () => {
    expect(settingsDialogFor("project-normals")).toBe("project");
    expect(settingsDialogFor("project-output")).toBe("project");
  });

  it("defaults land on each dialog's lead screen", () => {
    expect(settingsDialogFor(SETTINGS_DEFAULT_SCREEN.prefs)).toBe("prefs");
    expect(settingsDialogFor(SETTINGS_DEFAULT_SCREEN.project)).toBe("project");
    expect(settingsDialogFor(SETTINGS_DEFAULT_SCREEN.doc)).toBe("doc");
  });
});
