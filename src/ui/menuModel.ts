import type { MenuModel } from "@carapace/shell";

/**
 * The in-window menu bar's declarative model (QC-CARRY-2 extraction from App). Pure: capability flags
 * in, MenuModel out — every item routes through the single `action(id)` dispatcher (App's
 * runMenuAction), which is also what the native application menu drives via IPC, so the two menus
 * can't diverge in behaviour. `about` is the one item that isn't a dispatcher action (it opens a
 * local dialog).
 */
export function buildMenuModel(opts: {
  action: (id: string) => void;
  about: () => void;
  /** Effective shortcut for a command id (rebind-aware) — display only; dispatch stays elsewhere. */
  keys: (id: string) => string | undefined;
  /** A project is open. */
  hasWorkspace: boolean;
  /** A document tab is active. */
  hasActive: boolean;
  hasSel: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasPresets: boolean;
  rulers: boolean;
  pixelGrid: boolean;
}): MenuModel {
  const { action, about, keys, hasWorkspace, hasActive, hasSel, canAlign, canDistribute, canUndo, canRedo, hasPresets, rulers, pixelGrid } = opts;
  return [
    {
      label: "&&File",
      items: [
        { label: "New Project…", shortcut: keys("new-project"), run: () => action("new-project") },
        { label: "Open Project…", shortcut: keys("open-project"), run: () => action("open-project") },
        { separator: true },
        { label: "New Document…", shortcut: keys("new-document"), enabled: hasWorkspace, run: () => action("new-document") },
        { label: "Reload Diffuse", enabled: hasActive, run: () => action("reload-diffuse") },
        { separator: true },
        { label: "Save", shortcut: keys("save"), enabled: hasActive, run: () => action("save") },
        { label: "Save All", shortcut: keys("save-all"), enabled: hasWorkspace, run: () => action("save-all") },
        { separator: true },
        { label: "Export NX", shortcut: keys("export-nx"), enabled: hasActive, run: () => action("export-nx") },
        { label: "Export Height Map", shortcut: keys("export-height"), enabled: hasActive, run: () => action("export-height") },
        { label: "Export All NX", shortcut: keys("export-all"), enabled: hasWorkspace, run: () => action("export-all") },
        { separator: true },
        { label: "Import Presets…", enabled: hasWorkspace, run: () => action("import-presets") },
        { label: "Export Presets…", enabled: hasWorkspace && hasPresets, run: () => action("export-presets") },
        { separator: true },
        { label: "Preferences…", shortcut: keys("preferences"), enabled: hasWorkspace, run: () => action("preferences") },
        { label: "Project Settings…", shortcut: keys("project-settings"), enabled: hasWorkspace, run: () => action("project-settings") },
        { label: "Document Settings…", shortcut: keys("document-settings"), enabled: hasActive, run: () => action("document-settings") },
      ],
    },
    {
      label: "&&Edit",
      items: [
        { label: "Undo", shortcut: keys("undo"), enabled: canUndo, run: () => action("undo") },
        { label: "Redo", shortcut: keys("redo"), enabled: canRedo, run: () => action("redo") },
        { separator: true },
        { label: "Copy", shortcut: keys("copy"), enabled: hasSel, run: () => action("copy") },
        { label: "Paste", shortcut: keys("paste"), enabled: hasActive, run: () => action("paste") },
        { separator: true },
        { label: "Duplicate", shortcut: keys("duplicate"), enabled: hasSel, run: () => action("duplicate") },
        { label: "Save as Preset", enabled: hasSel, run: () => action("save-preset") },
        { label: "Delete", enabled: hasSel, run: () => action("delete") },
        { label: "Rename", shortcut: keys("rename"), enabled: hasSel, run: () => action("rename") },
        { separator: true },
        { label: "Group", shortcut: keys("group"), enabled: hasSel, run: () => action("group") },
        { label: "Ungroup", shortcut: keys("ungroup"), enabled: hasSel, run: () => action("ungroup") },
      ],
    },
    {
      label: "&&Arrange",
      items: [
        { label: "Align Left", enabled: canAlign, run: () => action("align-left") },
        { label: "Align Center", enabled: canAlign, run: () => action("align-hcenter") },
        { label: "Align Right", enabled: canAlign, run: () => action("align-right") },
        { separator: true },
        { label: "Align Top", enabled: canAlign, run: () => action("align-top") },
        { label: "Align Middle", enabled: canAlign, run: () => action("align-vcenter") },
        { label: "Align Bottom", enabled: canAlign, run: () => action("align-bottom") },
        { separator: true },
        { label: "Distribute Horizontally", enabled: canDistribute, run: () => action("distribute-h") },
        { label: "Distribute Vertically", enabled: canDistribute, run: () => action("distribute-v") },
        { separator: true },
        { label: "Flip Horizontal", enabled: hasSel, run: () => action("flip-h") },
        { label: "Flip Vertical", enabled: hasSel, run: () => action("flip-v") },
        { separator: true },
        { label: "Bring Forward", enabled: hasSel, run: () => action("order-front") },
        { label: "Send Backward", enabled: hasSel, run: () => action("order-back") },
      ],
    },
    {
      label: "&&View",
      items: [
        { label: "Fit", shortcut: keys("zoom-fit"), enabled: hasActive, run: () => action("zoom-fit") },
        { label: "Fit Selection", shortcut: keys("zoom-fit-selection"), enabled: hasSel, run: () => action("zoom-fit-selection") },
        { label: "100%", shortcut: keys("zoom-100"), enabled: hasActive, run: () => action("zoom-100") },
        { separator: true },
        { label: "Rulers", shortcut: keys("toggle-rulers"), enabled: hasActive, role: "checkbox", checked: rulers, keepOpen: true, run: () => action("toggle-rulers") },
        { label: "Pixel Grid", shortcut: keys("toggle-pixel-grid"), enabled: hasActive, role: "checkbox", checked: pixelGrid, keepOpen: true, run: () => action("toggle-pixel-grid") },
        { separator: true },
        { label: "Command Palette…", shortcut: keys("command-palette"), run: () => action("command-palette") },
      ],
    },
    {
      label: "&&Help",
      items: [
        { label: "Check for Updates…", run: () => action("check-updates") },
        { separator: true },
        { label: "About Lambert", run: about },
      ],
    },
  ];
}
