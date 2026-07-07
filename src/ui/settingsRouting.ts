/** Which of the three settings dialogs a screen id belongs to — the ids encode it by prefix. */
export type SettingsDialogKind = "prefs" | "project" | "doc";

/** Each dialog's lead screen — where it opens the first time (per-dialog last-screen persists after). */
export const SETTINGS_DEFAULT_SCREEN: Record<SettingsDialogKind, string> = {
  prefs: "app-shortcuts",
  project: "project-normals",
  doc: "doc-canvas",
};

export function settingsDialogFor(screen: string): SettingsDialogKind {
  if (screen.startsWith("app-")) return "prefs";
  if (screen.startsWith("doc-")) return "doc";
  return "project";
}
