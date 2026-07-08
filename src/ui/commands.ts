/**
 * The command model — the single source of truth for every action's id, label, category, default
 * binding, and scope. The application menu (native + in-window), the editor keymap, the command
 * palette, and the Settings > Shortcuts editor all derive from this list, so an id can't drift
 * between them. User rebinds are stored as overrides keyed by id (usePersistentState).
 */

export type CommandScope = "global" | "editor";

/** What must be true for the command to run — mapped to live workspace checks in App. */
// "active" = any open tab (image included); "doc" = an open DOCUMENT tab
export type CommandEnable = "always" | "workspace" | "active" | "doc" | "sel" | "align" | "distribute" | "undo" | "redo" | "presets" | "never";

export interface CommandSpec {
  id: string;
  label: string;
  category: string;
  /** Default chord ("Ctrl+S"); null = unbound by default. */
  keys: string | null;
  /** global: fired by the native application-menu accelerator (works everywhere).
   *  editor: fired by the window keymap (needs an active document, skipped while typing in inputs). */
  scope: CommandScope;
  enable: CommandEnable;
  /** Informational mouse gesture shown in the shortcut editor (not recordable). */
  mouse?: string;
}

export const COMMANDS: CommandSpec[] = [
  // File
  { id: "new-project", label: "New Project…", category: "File", keys: "Ctrl+Shift+N", scope: "global", enable: "always" },
  { id: "open-project", label: "Open Project…", category: "File", keys: "Ctrl+O", scope: "global", enable: "always" },
  { id: "new-document", label: "New Document…", category: "File", keys: "Ctrl+N", scope: "global", enable: "workspace" },
  { id: "reload-diffuse", label: "Reload Diffuse", category: "File", keys: null, scope: "global", enable: "doc" },
  { id: "save", label: "Save", category: "File", keys: "Ctrl+S", scope: "global", enable: "doc" },
  { id: "save-all", label: "Save All", category: "File", keys: "Ctrl+Shift+S", scope: "global", enable: "workspace" },
  // tab verbs (Photoshop chords; carapace EditorTabs supplies the context menu, these back the keys)
  { id: "close-tab", label: "Close Tab", category: "File", keys: "Ctrl+W", scope: "global", enable: "active" },
  { id: "close-others", label: "Close Other Tabs", category: "File", keys: "Ctrl+Alt+P", scope: "global", enable: "active" },
  { id: "close-right", label: "Close Tabs to the Right", category: "File", keys: null, scope: "global", enable: "active" },
  { id: "close-saved", label: "Close Saved Tabs", category: "File", keys: null, scope: "global", enable: "active" },
  { id: "close-all", label: "Close All Tabs", category: "File", keys: "Ctrl+Alt+W", scope: "global", enable: "active" },
  { id: "pin-tab", label: "Pin / Unpin Tab", category: "File", keys: null, scope: "global", enable: "active" },
  { id: "export-nx", label: "Export NX", category: "File", keys: "Ctrl+E", scope: "global", enable: "doc" },
  { id: "export-height", label: "Export Height Map", category: "File", keys: null, scope: "global", enable: "doc" },
  { id: "export-all", label: "Export All NX", category: "File", keys: "Ctrl+Shift+E", scope: "global", enable: "workspace" },
  { id: "import-presets", label: "Import Presets…", category: "File", keys: null, scope: "global", enable: "workspace" },
  { id: "export-presets", label: "Export Presets…", category: "File", keys: null, scope: "global", enable: "presets" },
  { id: "preferences", label: "Preferences…", category: "File", keys: "Ctrl+K", scope: "global", enable: "always" },
  { id: "project-settings", label: "Project Settings…", category: "File", keys: null, scope: "global", enable: "workspace" },
  { id: "document-settings", label: "Document Settings…", category: "File", keys: null, scope: "global", enable: "doc" },

  // Edit
  { id: "undo", label: "Undo", category: "Edit", keys: "Ctrl+Z", scope: "global", enable: "undo" },
  { id: "redo", label: "Redo", category: "Edit", keys: "Ctrl+Shift+Z", scope: "global", enable: "redo" },
  { id: "copy", label: "Copy", category: "Edit", keys: "Ctrl+C", scope: "editor", enable: "sel" },
  { id: "paste", label: "Paste", category: "Edit", keys: "Ctrl+V", scope: "editor", enable: "doc" },
  { id: "duplicate", label: "Duplicate", category: "Edit", keys: "Ctrl+J", scope: "global", enable: "sel" },
  { id: "save-preset", label: "Save as Preset", category: "Edit", keys: null, scope: "global", enable: "sel" },
  { id: "delete", label: "Delete", category: "Edit", keys: "Delete", scope: "editor", enable: "sel" },
  { id: "rename", label: "Rename", category: "Edit", keys: "F2", scope: "editor", enable: "sel" },
  { id: "deselect", label: "Deselect", category: "Edit", keys: "Ctrl+D", scope: "editor", enable: "sel" },
  { id: "group", label: "Group", category: "Edit", keys: "Ctrl+G", scope: "global", enable: "sel" },
  { id: "ungroup", label: "Ungroup", category: "Edit", keys: "Ctrl+Shift+G", scope: "global", enable: "sel" },

  // Arrange
  { id: "align-left", label: "Align Left", category: "Arrange", keys: null, scope: "editor", enable: "align" },
  { id: "align-hcenter", label: "Align Center", category: "Arrange", keys: null, scope: "editor", enable: "align" },
  { id: "align-right", label: "Align Right", category: "Arrange", keys: null, scope: "editor", enable: "align" },
  { id: "align-top", label: "Align Top", category: "Arrange", keys: null, scope: "editor", enable: "align" },
  { id: "align-vcenter", label: "Align Middle", category: "Arrange", keys: null, scope: "editor", enable: "align" },
  { id: "align-bottom", label: "Align Bottom", category: "Arrange", keys: null, scope: "editor", enable: "align" },
  { id: "distribute-h", label: "Distribute Horizontally", category: "Arrange", keys: null, scope: "editor", enable: "distribute" },
  { id: "distribute-v", label: "Distribute Vertically", category: "Arrange", keys: null, scope: "editor", enable: "distribute" },
  { id: "flip-h", label: "Flip Horizontal", category: "Arrange", keys: null, scope: "editor", enable: "sel" },
  { id: "flip-v", label: "Flip Vertical", category: "Arrange", keys: null, scope: "editor", enable: "sel" },
  { id: "order-front", label: "Bring Forward", category: "Arrange", keys: "Ctrl+]", scope: "editor", enable: "sel" },
  { id: "order-back", label: "Send Backward", category: "Arrange", keys: "Ctrl+[", scope: "editor", enable: "sel" },
  { id: "order-top", label: "Bring to Front", category: "Arrange", keys: "Ctrl+Shift+]", scope: "editor", enable: "sel" },
  { id: "order-bottom", label: "Send to Back", category: "Arrange", keys: "Ctrl+Shift+[", scope: "editor", enable: "sel" },

  // View
  { id: "zoom-fit", label: "Fit", category: "View", keys: "Ctrl+0", scope: "global", enable: "doc" },
  { id: "zoom-fit-selection", label: "Fit Selection", category: "View", keys: "Ctrl+Shift+0", scope: "global", enable: "sel" },
  { id: "zoom-100", label: "100%", category: "View", keys: "Ctrl+1", scope: "global", enable: "doc" },
  { id: "zoom-in", label: "Zoom In", category: "View", keys: "Ctrl+=", scope: "global", enable: "doc" },
  { id: "zoom-out", label: "Zoom Out", category: "View", keys: "Ctrl+-", scope: "global", enable: "doc" },
  { id: "tab-next", label: "Next Tab", category: "View", keys: "Ctrl+Tab", scope: "global", enable: "active" },
  { id: "tab-prev", label: "Previous Tab", category: "View", keys: "Ctrl+Shift+Tab", scope: "global", enable: "active" },
  { id: "toggle-rulers", label: "Rulers", category: "View", keys: "Ctrl+R", scope: "global", enable: "active" },
  { id: "toggle-pixel-grid", label: "Pixel Grid", category: "View", keys: null, scope: "global", enable: "active" },
  { id: "view-cycle", label: "Cycle View Mode", category: "View", keys: "F", scope: "editor", enable: "doc" },
  { id: "view-toggle-last", label: "Toggle Last View Mode", category: "View", keys: "Shift+F", scope: "editor", enable: "doc" },
  { id: "view-swap", label: "Swap 2D / 3D Panes", category: "View", keys: "X", scope: "editor", enable: "doc" },
  { id: "command-palette", label: "Command Palette…", category: "View", keys: "Ctrl+Shift+P", scope: "global", enable: "always" },

  // Tools (Photoshop-style single keys: V move/select, A direct-select, I ruler; R/S/W have no PS analog)
  { id: "tool-select", label: "Select", category: "Tools", keys: "V", scope: "editor", enable: "active" },
  { id: "tool-move", label: "Move", category: "Tools", keys: "W", scope: "editor", enable: "active" },
  { id: "tool-rotate", label: "Rotate", category: "Tools", keys: "R", scope: "editor", enable: "active" },
  { id: "tool-scale", label: "Scale", category: "Tools", keys: "S", scope: "editor", enable: "active" },
  { id: "tool-vertex", label: "Vertex", category: "Tools", keys: "A", scope: "editor", enable: "active" },
  { id: "tool-pen", label: "Pen", category: "Tools", keys: "P", scope: "editor", enable: "active" },
  { id: "tool-measure", label: "Measure", category: "Tools", keys: "I", scope: "editor", enable: "active" },

  // Canvas gestures (informational: shown in the shortcut editor, not rebindable/runnable)
  { id: "canvas-pan", label: "Pan", category: "Canvas", keys: null, scope: "editor", enable: "never", mouse: "Middle-drag / Space+drag" },
  { id: "canvas-zoom", label: "Zoom", category: "Canvas", keys: null, scope: "editor", enable: "never", mouse: "Ctrl+Wheel / Wheel" },

  // Help
  { id: "check-updates", label: "Check for Updates…", category: "Help", keys: null, scope: "global", enable: "always" },
];

/** User overrides keyed by command id: a chord string rebinds, null unbinds, absent = default. */
export type BindingOverrides = Record<string, string | null>;

/** The chord a command actually fires on: the user override if present, else the spec default. */
export function effectiveKeys(spec: CommandSpec, overrides: BindingOverrides): string | null {
  return spec.id in overrides ? (overrides[spec.id] ?? null) : spec.keys;
}

/** Pre-v0.5 the three settings dialogs were one "settings" command — carry a user rebind over. */
export function migrateLegacyOverrides(prev: BindingOverrides): BindingOverrides {
  if (!("settings" in prev)) return prev;
  const { settings, ...rest } = prev;
  return "preferences" in rest ? rest : { ...rest, preferences: settings ?? null };
}
