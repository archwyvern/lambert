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
}): MenuModel {
  const { action, about, hasWorkspace, hasActive, hasSel, canAlign, canDistribute, canUndo, canRedo, hasPresets, rulers } = opts;
  return [
    {
      label: "&&File",
      items: [
        { label: "New Project…", shortcut: "Ctrl+Shift+N", run: () => action("new-project") },
        { label: "Open Project…", shortcut: "Ctrl+O", run: () => action("open-project") },
        { separator: true },
        { label: "New Document…", shortcut: "Ctrl+N", enabled: hasWorkspace, run: () => action("new-document") },
        { label: "Reload Diffuse", enabled: hasActive, run: () => action("reload-diffuse") },
        { separator: true },
        { label: "Save", shortcut: "Ctrl+S", enabled: hasActive, run: () => action("save") },
        { label: "Save All", shortcut: "Ctrl+Shift+S", enabled: hasWorkspace, run: () => action("save-all") },
        { separator: true },
        { label: "Export NX", shortcut: "Ctrl+E", enabled: hasActive, run: () => action("export-nx") },
        { label: "Export All NX", shortcut: "Ctrl+Shift+E", enabled: hasWorkspace, run: () => action("export-all") },
        { separator: true },
        { label: "Import Presets…", enabled: hasWorkspace, run: () => action("import-presets") },
        { label: "Export Presets…", enabled: hasWorkspace && hasPresets, run: () => action("export-presets") },
      ],
    },
    {
      label: "&&Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", enabled: canUndo, run: () => action("undo") },
        { label: "Redo", shortcut: "Ctrl+Y", enabled: canRedo, run: () => action("redo") },
        { separator: true },
        { label: "Copy", shortcut: "Ctrl+C", enabled: hasSel, run: () => action("copy") },
        { label: "Paste", shortcut: "Ctrl+V", enabled: hasActive, run: () => action("paste") },
        { separator: true },
        { label: "Duplicate", shortcut: "Ctrl+D", enabled: hasSel, run: () => action("duplicate") },
        { label: "Save as Preset", enabled: hasSel, run: () => action("save-preset") },
        { label: "Delete", enabled: hasSel, run: () => action("delete") },
        { separator: true },
        { label: "Group", shortcut: "Ctrl+G", enabled: hasSel, run: () => action("group") },
        { label: "Ungroup", shortcut: "Ctrl+Shift+G", enabled: hasSel, run: () => action("ungroup") },
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
        { label: "Fit", shortcut: "Ctrl+0", enabled: hasActive, run: () => action("zoom-fit") },
        { label: "Fit Selection", shortcut: "Ctrl+Shift+0", enabled: hasSel, run: () => action("zoom-fit-selection") },
        { label: "100%", shortcut: "Ctrl+1", enabled: hasActive, run: () => action("zoom-100") },
        { separator: true },
        { label: "Rulers", shortcut: "Ctrl+R", enabled: hasActive, role: "checkbox", checked: rulers, keepOpen: true, run: () => action("toggle-rulers") },
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
