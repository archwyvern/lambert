import "./styles.css";
import "@carapace/shell/seti.css";
import "./fileIcons";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { decode, encode } from "fast-png";
import { DocumentStore } from "../document/store";
import { addInstanceNear, duplicateObject, moveObjectTo, removeObject, reorderObject, updateObject } from "../document/docOps";
import { createFromPreset } from "../field/presets";
import { bakeRings, bezierAnchor } from "../field/bezier";
import { addNode, cloneNode, findNode, siblingsOf, ungroup, updateNode, wrapInGroup } from "../document/layerOps";
import { flattenLayers } from "../field/flatten";
import { isGroup, isObject, type LayerNode, type ObjectInstance } from "../field/types";
import { Vector2, Vector3 } from "@carapace/primitives";
import { effectiveNormalDirs, effectiveOutput, emptyDoc, hydrateObjectRaw, parseDoc, parseProjectConfig, presetLibrarySchema, ProjectConfig, serializeDoc, serializeProjectConfig, type LambertDoc, type SavedPreset } from "../document/schema";
import { getObjectType, ObjectTypeId } from "../field/registry";
import { DimsMismatchError, exportDocNx, exportTabHeightmap, exportTabNx, newProjectFlow, openDocTab, openProjectByPath, openProjectFlow, renderDocNx, saveTab, type OpenedProject } from "../document/io";
import { nxExtension } from "../document/exports";
import { migrateDocToDims, type ResizeMode } from "../document/migrate";
import { ResizeMigrationDialog } from "./ResizeMigrationDialog";
import { healDiffuse, relativizeSourceUri, resolveDiffuse } from "../document/diffuseSource";
import { basename, dirname, joinPath } from "../document/paths";
import { pushRecent, removeRecent, type RecentProject } from "../document/recents";
import { buildSessionJson, parseSessionJson } from "../document/session";
import { PROJECT_FILE, Tab, tabPath, Workspace } from "../document/workspace";
import type { DocTab } from "../document/workspace";
import { alignNodes, distributeNodes, type AlignMode } from "./alignOps";
import { buildMenuModel } from "./menuModel";
import { BindingOverrides, COMMANDS, effectiveKeys, migrateLegacyOverrides } from "./commands";
import { SETTINGS_DEFAULT_SCREEN, settingsDialogFor, type SettingsDialogKind } from "./settingsRouting";
import { useDemoBootstrap } from "./useDemoBootstrap";
import { parseEditorBindings, useEditorKeymap, type EditorBinding } from "./useEditorKeymap";
import { CommandPalette, CommandProvider, createCommandRegistry } from "@carapace/shell";
import { CanvasView } from "./CanvasView";
import type { Viewport } from "./viewport";
import { DEFAULT_ORBIT, type Orbit } from "../field/gpu/preview3d";
import { Preview3D } from "./Preview3D";
import { use3DCamera } from "./use3DCamera";
import { ToolPalette } from "./ToolPalette";
import { carapaceHost, getHost } from "./host";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { Library } from "./Library";
import { Button, ICON, SectionLabel } from "./kit";
import { UpdateNotice } from "./UpdateNotice";
import { FileExplorer, FileTypeIcon, ImageView } from "@carapace/shell";
import type { ImageViewInfo } from "@carapace/shell";
import type { DirEntry, FileExplorerActions, FileExplorerProps, MenuModel } from "@carapace/shell";
import { usePersistentState } from "./persist";
import { loadSidecar, saveSidecar } from "../remote/sidecar";
import type { Sidecar } from "../remote/sync";
import { runPull, runPush, runPushNamed, type SyncUi } from "../remote/runner";
import { makeDavClient, normalizeServer, type RemoteServer } from "../remote/servers";
import { davTransport, localIo, sidecarIo } from "./remoteGlue";
import { Sash, SplitView, EditorTabs, tabVerbIds, StatusBar, formatKeys, KeybindingProvider, useConfirm, EmptyState, parseGitPorcelainZ, scmDecoration, type ScmDecoration, type MenuItem, type TabMenuVerb } from "@carapace/shell";
import { Toolbar } from "./Toolbar";
import { ViewControls } from "./ViewControls";
import { LambertMark } from "./LambertMark";
import { LaunchScreen } from "./LaunchScreen";
import { RemoteCloneDialog } from "./RemoteCloneDialog";
import { NewDocumentDialog } from "./NewDocumentDialog";
import { AboutDialog } from "./AboutDialog";
import { DocumentSettingsDialog, PreferencesDialog, ProjectSettingsDialog } from "./SettingsDialog";
import type { ViewMode, PointLight } from "./preview";
import { VIEW_MODES } from "./preview";
import { ToolMode } from "./tools";
import { v2 } from "../field/vec";

const clampPanel = (w: number): number => Math.min(480, Math.max(160, w));
const clampCorner = (h: number): number => Math.min(800, Math.max(120, h));
const clampSection = (h: number): number => Math.min(1200, Math.max(96, h)); // Layers pane in the left split

// dirs the explorer never descends into (matches drydock's tree pruning)
const IGNORED_DIRS = new Set(["node_modules", ".git", "bin", "obj", ".godot"]);

// image types the explorer lists and ImageView renders (whatever <img> decodes)
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const IMAGE_MIMES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml",
};
function imageMime(path: string): string {
  return IMAGE_MIMES[path.toLowerCase().split(".").pop() ?? ""] ?? "application/octet-stream";
}

export interface ViewState {
  mode: ViewMode;
  /** Overlay opacity for the normal view (1 = 100%). */
  opacity: number;
  lightDir: [number, number, number];
  /** Lit view: light intensity multiplier (1 = default). */
  lightEnergy: number;
  /** Lit-preview point lights (2). Preview-only (never exported); transient like lightEnergy. */
  pointLights: PointLight[];
  /** The mode active before the current one — target of the "toggle last view" command (Shift+V).
   *  Transient, like lightEnergy: not in the session schema, backfilled from DEFAULT_VIEW per session. */
  prevMode?: ViewMode;
}

const DEFAULT_VIEW: ViewState = {
  mode: "normal",
  opacity: 1,
  lightDir: [-0.5, -0.5, 0.7],
  lightEnergy: 1,
  prevMode: "diffuse",
  pointLights: [
    { on: false, x: 0.35, y: 0.4, height: 0.5, intensity: 0.8, color: [1.0, 0.85, 0.65] }, // warm key
    { on: false, x: 0.65, y: 0.6, height: 0.5, intensity: 0.8, color: [0.6, 0.78, 1.0] }, // cool fill
  ],
};

/** In-app object clipboard (Copy/Paste), module-level so it survives across tabs — an artist can copy a
 *  tuned object from one .lmb tab and paste it into another. Snapshots node refs (the store's immutable
 *  updates never mutate them); Paste deep-clones with fresh ids. */
let objectClipboard: LayerNode[] = [];

export function App(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [views, setViews] = useState<Record<string, ViewState>>({}); // per-tab (by tab.id) view state
  const [viewports, setViewports] = useState<Record<string, Viewport>>({}); // per-tab 2D pan/zoom
  const [orbits, setOrbits] = useState<Record<string, Orbit>>({}); // per-tab 3D camera
  const [tool, setTool] = useState<ToolMode>("select");
  const [selVerts, setSelVerts] = useState<number[]>([]);
  const [showAbout, setShowAbout] = useState(false);
  // Settings family: which of the three dialogs is open (null = none); each remembers its
  // last-viewed screen per-machine so reopening lands where you left off.
  const [settingsOpen, setSettingsOpen] = useState<SettingsDialogKind | null>(null);
  const [prefsScreen, setPrefsScreen] = usePersistentState("prefs:screen", SETTINGS_DEFAULT_SCREEN.prefs);
  const [projectScreen, setProjectScreen] = usePersistentState("projectSettings:screen", SETTINGS_DEFAULT_SCREEN.project);
  const [docScreen, setDocScreen] = usePersistentState("docSettings:screen", SETTINGS_DEFAULT_SCREEN.doc);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // a two-step chord prefix is waiting for its second keystroke (status-bar hint)
  const [chordPending, setChordPending] = useState<string | null>(null);
  // Rebindable shortcuts: user overrides by command id (chord rebinds, null unbinds, absent = default).
  // The same map also carries carapace component-binding overrides (dotted ids, e.g. "tree.rename").
  const [bindingOverrides, setBindingOverrides] = usePersistentState<BindingOverrides>("keybindings", {});
  const keybindingsConfig = useMemo(() => ({ overrides: bindingOverrides }), [bindingOverrides]);
  // pre-v0.5 stored rebinds against the single "settings" command — rename once on startup
  useEffect(() => setBindingOverrides(migrateLegacyOverrides), []);
  const bindings = useMemo(
    () => new Map(COMMANDS.map((c) => [c.id, effectiveKeys(c, bindingOverrides)])),
    [bindingOverrides],
  );
  // editor-scope commands with parsed chords, consumed by the window keymap via a ref
  const editorBindingsRef = useRef<EditorBinding[]>([]);
  editorBindingsRef.current = useMemo(
    () =>
      parseEditorBindings(
        COMMANDS.filter((c) => c.scope === "editor" && c.enable !== "never" && bindings.get(c.id))
          .map((c) => [c.id, bindings.get(c.id)!]),
      ),
    [bindings],
  );
  // native menu accelerators track the effective bindings (main rebuilds the OS menu). Two-step
  // chords can't be Electron accelerators — those commands fire via the window keymap only.
  useEffect(() => {
    const map: Record<string, string | null> = {};
    for (const c of COMMANDS) {
      if (c.scope !== "global") continue;
      const keys = bindings.get(c.id) ?? null;
      map[c.id] = keys && !keys.includes(" ") ? keys : null;
    }
    void getHost().setMenuAccelerators(map);
  }, [bindings]);
  // New Document = name-first: the explorer's inline editor sets the path, then a modal picks the
  // diffuse source; the .lmb is written only if the source resolves. newDocPath holds that path.
  const [newDocPath, setNewDocPath] = useState<string | null>(null);
  const explorerActions = useRef<FileExplorerActions | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageViewInfo | null>(null); // active image tab's size/zoom (status bar)
  const selVertsRef = useRef(selVerts);
  selVertsRef.current = selVerts;
  const nudgeEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // commits a nudge burst's undo group
  const [snap, setSnap] = usePersistentState("snap", true); // global ½px grid snap for all edits
  const [rulers, setRulers] = usePersistentState("rulers", true); // top/left canvas rulers (View > Rulers)
  const [pixelGrid, setPixelGrid] = usePersistentState("pixelGrid", true); // 1px-cell grid past ~800% zoom
  // normal view: hide the encode where the diffuse is transparent (matches the export's alpha gate)
  const [normalAlphaGate, setNormalAlphaGate] = usePersistentState("normalAlphaGate", true);
  const [autoUpdateCheck, setAutoUpdateCheck] = usePersistentState("autoUpdateCheck", true); // startup update check (Settings › Updates)
  const [recents, setRecents] = usePersistentState<RecentProject[]>("recentProjects", []); // launch-screen MRU
  // remote projects: configured WebDAV servers (app-level) + the open project's sync state (null =
  // not a remote project). sidecarRef keeps the command registry's stable closures honest.
  const [remoteServers, setRemoteServers] = usePersistentState<RemoteServer[]>("remoteServers", []);
  // one-time shape migration: v0.6.0 entries stored flat username/password (pre-auth-modes)
  useEffect(() => setRemoteServers((prev) => prev.map(normalizeServer)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [remoteCloneOpen, setRemoteCloneOpen] = useState(false);
  const [sidecar, setSidecar] = useState<Sidecar | null>(null);
  const sidecarRef = useRef<Sidecar | null>(null);
  sidecarRef.current = sidecar;
  const [lastDir, setLastDir] = usePersistentState<string | null>("lastProjectDir", null); // open-dialog defaultPath
  const [leftWidth, setLeftWidth] = usePersistentState("panel:left", 220);
  const [layersHeight, setLayersHeight] = usePersistentState("panel:layers", 280);
  const [rightWidth, setRightWidth] = usePersistentState("panel:right", 288);
  const confirm = useConfirm();
  const cam3d = use3DCamera();
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const [swapped, setSwapped] = usePersistentState("panel:3d:swapped", false);
  // 3D preview OFF by default: the displaced-grid fold is the most expensive pass in the app, so
  // it only runs when the user opts in (click the pane to enable; the power button disables)
  // (the `3d` query flag pre-enables it for capture/demo shots — automation profiles are fresh)
  const [preview3dOn, setPreview3dOn] = usePersistentState("panel:3d:enabled", new URLSearchParams(location.search).has("3d"));
  const [boxMode, setBoxMode] = usePersistentState<"3d" | "lit">("panel:3d:mode", "lit"); // inspection box: lit composite (default) vs orbit 3D
  const [boxLitViewport, setBoxLitViewport] = useState<Viewport | null>(null); // the box's independent lit camera (in-memory, driven by Preview3D)
  const [cornerHeight, setCornerHeight] = usePersistentState("panel:3d:corner", 300);
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const active = workspace?.active ?? null;
  const activeDoc = active?.kind === "doc" ? active : null;
  const activeImage = active?.kind === "image" ? active : null;
  const state = activeDoc?.store.state ?? null;

  // All transient feedback lands in the status bar — no toasts. Info auto-clears, errors linger longer.
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = (msg: string, tone: "info" | "error" = "info"): void => {
    setStatus({ text: msg, tone });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), tone === "error" ? 8000 : 4000);
  };
  const run = (p: Promise<unknown>): void =>
    void p
      .then((msg) => {
        if (typeof msg === "string") notify(msg);
      })
      .catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), "error"));

  // re-render whenever the workspace structure or the active document changes
  useEffect(() => (workspace ? workspace.subscribe(forceUpdate) : undefined), [workspace]);
  useEffect(() => (activeDoc ? activeDoc.store.subscribe(forceUpdate) : undefined), [activeDoc]);
  useEffect(() => setSelVerts([]), [state?.selectedId]);
  useEffect(() => setSelVerts([]), [active?.id]); // drop stale vertex indices when switching tabs

  // window title tracks the active document + dirty state (nothing set it before — it stayed "Lambert")
  useEffect(() => {
    const p = active ? tabPath(active) : null;
    const name = active ? (p ? basename(p) : "Untitled") : null;
    document.title = name ? `${state?.dirty ? "• " : ""}${name} — Lambert` : "Lambert";
  }, [active, state?.dirty]);

  useEffect(() => {
    if (!activeImage) setImageInfo(null);
  }, [activeImage]);

  // 3D camera persistence: re-seed the orbit from the per-image saved camera when the active image
  // changes (default framing on first open), and report camera moves back so each image keeps its own
  // angle — survives tab switch + reload, instead of one global camera shared across all images.
  useEffect(() => {
    if (active) cam3d.setOrbit(orbitsRef.current[active.id] ?? { ...DEFAULT_ORBIT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  useEffect(() => {
    if (active) setOrbits((m) => (m[active.id] === cam3d.orbit ? m : { ...m, [active.id]: cam3d.orbit }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam3d.orbit]);

  // stable refs for the menu/keydown/close listeners (registered once)
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const viewportsRef = useRef(viewports);
  viewportsRef.current = viewports;
  const orbitsRef = useRef(orbits);
  orbitsRef.current = orbits;

  const activeView = (active && views[active.id]) || DEFAULT_VIEW;
  const setActiveView = (fn: (v: ViewState) => ViewState): void => {
    const t = workspaceRef.current?.active;
    if (!t) return;
    setViews((vs) => ({ ...vs, [t.id]: fn(vs[t.id] ?? DEFAULT_VIEW) }));
  };

  // launch-screen recent-projects list. Record on every open (button or restore) so it stays honest;
  // a failed open self-heals by dropping the dead row.
  const recordRecent = (path: string): void =>
    setRecents((rs) => pushRecent(rs, path, basename(path.replace(/\/+$/, "")) || path, Date.now()));
  const removeRecentProject = (path: string): void => setRecents((rs) => removeRecent(rs, path));

  // Remote projects: a project is remote iff its sidecar exists; corruption is soft (re-clone
  // recovers). EVERY way into a project must call this — enterProject and the session restore —
  // or the remote verbs grey out and the root row loses the server's name.
  const refreshSidecar = (projectPath: string): void => {
    setSidecar(null);
    void loadSidecar(sidecarIo(getHost()), projectPath).then((s) => {
      if (s === "corrupt") notify("Remote sync state is corrupted — re-clone the project to restore syncing", "error");
      else if (s) setSidecar(s);
    });
  };

  const enterProject = (opened: OpenedProject): string => {
    setWorkspace(new Workspace(opened.projectPath, opened.config));
    setViews({});
    refreshSidecar(opened.projectPath);
    recordRecent(opened.projectPath);
    setLastDir(dirname(opened.projectPath)); // reopen the dialog at the project's containing folder next time
    getHost().notifyProjectOpened(); // grow the welcome window to the remembered editor size
    return `Opened ${opened.projectPath}`;
  };

  /** Snapshot every persisted lambert:* pref to seed a spawned window's fresh profile. Update
   *  checks are forced off in the copy — exactly one window (the primary) should drive updates. */
  const snapshotPrefs = (): string => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("lambert:")) out[k] = localStorage.getItem(k)!;
    }
    out["lambert:autoUpdateCheck"] = "false";
    return JSON.stringify(out);
  };

  /** Open `opened` here, or — when a project is already up — offer this window / a new window.
   *  With no workspace there's nothing to displace, so it opens right here without asking. */
  const enterProjectRouted = async (opened: OpenedProject): Promise<string | null> => {
    if (!workspaceRef.current) return enterProject(opened);
    const name = basename(opened.projectPath.replace(/\/+$/, "")) || opened.projectPath;
    const r = await confirm({
      title: `Open ${name}`,
      message: "Open it in this window (the current project's tabs are set aside), or in a new window?",
      confirmLabel: "This Window",
      tertiaryLabel: "New Window",
      cancelLabel: "Cancel",
    });
    if (r === "cancel") return null;
    if (r === "tertiary") {
      recordRecent(opened.projectPath);
      await getHost().openInNewWindow(opened.projectPath, snapshotPrefs());
      return `Opened ${name} in a new window`;
    }
    return enterProject(opened);
  };

  const openProject = (which: "open" | "new"): void =>
    run(
      (async () => {
        const opened = await (which === "new" ? newProjectFlow : openProjectFlow)(getHost(), lastDir ?? undefined);
        if (!opened) return;
        return enterProjectRouted(opened);
      })(),
    );

  // one-click reopen from the launch screen; a moved/deleted project drops itself from the list
  const openRecent = (path: string): void =>
    run(
      (async () => {
        try {
          return await enterProjectRouted(await openProjectByPath(getHost(), path));
        } catch {
          removeRecentProject(path);
          throw new Error(`${basename(path)} is no longer available — removed from recent projects`);
        }
      })(),
    );

  // open a project from an explicit folder path — the OS handing us a double-clicked project.lambert
  const openPath = (dir: string): void => run((async () => enterProjectRouted(await openProjectByPath(getHost(), dir)))());
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;

  // Diffuse-resize migration prompt (open / reload hit a dims mismatch); null = closed
  const [resizeAsk, setResizeAsk] = useState<
    | { kind: "open"; docPath: string; doc: LambertDoc; bytes: Uint8Array; width: number; height: number }
    | { kind: "reload"; tabId: string; bytes: Uint8Array; width: number; height: number; oldW: number; oldH: number }
    | null
  >(null);

  const applyResizeMigration = (mode: ResizeMode): void => {
    const ask = resizeAsk;
    setResizeAsk(null);
    const ws = workspaceRef.current;
    if (!ask || !ws) return;
    if (ask.kind === "open") {
      // open the tab on the MIGRATED doc, dirty (the migration is an unsaved change)
      const migrated = migrateDocToDims(ask.doc, ask.width, ask.height, mode);
      const store = new DocumentStore(migrated, ask.docPath);
      store.reset(migrated, ask.docPath, { dirty: true });
      const tab: Tab = { kind: "doc", id: crypto.randomUUID(), docPath: ask.docPath, store, diffuse: { bytes: ask.bytes } };
      const prevView = (ws.active && viewsRef.current[ws.active.id]) || DEFAULT_VIEW;
      setViews((vs) => ({ ...vs, [tab.id]: { ...prevView } }));
      ws.openTab(tab);
      notify(`Opened ${basename(ask.docPath)} at ${ask.width}×${ask.height} (${mode === "adopt" ? "positions kept" : "objects scaled"}) — save to keep`);
    } else {
      const t = ws.tabs[ws.indexById(ask.tabId)];
      if (!t || t.kind !== "doc") return;
      t.store.update((d) => migrateDocToDims(d, ask.width, ask.height, mode));
      t.store.endGesture();
      t.diffuse.bytes = ask.bytes;
      t.diffuse.unresolved = false;
      ws.notify();
      notify(`Reloaded diffuse at ${ask.width}×${ask.height} (${mode === "adopt" ? "positions kept" : "objects scaled"})`);
    }
  };

  // open a saved .lmb from the explorer; focus it if already open, else load + resolve its diffuse
  const openDoc = (docPath: string): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const existing = ws.indexByDocPath(docPath);
    if (existing >= 0) {
      ws.focus(ws.tabs[existing]!.id);
      return;
    }
    run(
      (async () => {
        let opened: Awaited<ReturnType<typeof openDocTab>>;
        try {
          opened = await openDocTab(getHost(), docPath, ws.projectPath);
        } catch (err) {
          if (err instanceof DimsMismatchError) {
            // the diffuse changed size: offer the adopt/scale migration instead of refusing
            setResizeAsk({ kind: "open", docPath, doc: err.doc, bytes: err.bytes, width: err.width, height: err.height });
            return;
          }
          throw err;
        }
        const { tab, droppedUnknown } = opened;
        // a new tab inherits the current tab's view (mode/opacity/light) rather than snapping to the
        // lit/100% default — so flipping between docs keeps the working view.
        const prevView = (ws.active && viewsRef.current[ws.active.id]) || DEFAULT_VIEW;
        setViews((vs) => ({ ...vs, [tab.id]: { ...prevView } }));
        ws.openTab(tab);
        if (droppedUnknown > 0) {
          return `Opened ${basename(docPath)} — dropped ${droppedUnknown} unrecognized object${droppedUnknown === 1 ? "" : "s"} (legacy/removed type)`;
        }
      })(),
    );
  };

  // open a source image from the explorer as a read-only viewer tab; focus if already open
  const openImageTab = (path: string): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const existing = ws.indexByDocPath(path);
    if (existing >= 0) {
      ws.focus(ws.tabs[existing]!.id);
      return;
    }
    run(
      (async () => {
        const bytes = await getHost().readFile(path);
        ws.openTab({ kind: "image", id: crypto.randomUUID(), path, bytes, mimeType: imageMime(path) });
      })(),
    );
  };

  // New Document (menu / empty-state): start the explorer's inline name editor at the project root.
  // Naming happens in the tree; beginNewDoc fires on commit with the chosen .lmb path.
  const newDocument = (): void => explorerActions.current?.startNewFile();

  // explorer committed a new .lmb name → open the source modal for that path (no file written yet)
  const beginNewDoc = (path: string): void => setNewDocPath(path);

  // keep open tabs in sync when the explorer renames/moves or deletes their .lmb underneath them
  // Explorer SCM row tinting (git status, read-only): repo-relative paths -> decoration, refreshed on
  // project open / save / rename / delete / window focus. Empty map = clean tree or not a repo.
  const [gitDecorations, setGitDecorations] = useState<Map<string, ScmDecoration>>(new Map());
  // Inspector "select this mask in the editor": bumps seq so MaskGizmo re-applies even for the same mask
  const [maskFocus, setMaskFocus] = useState<{ nodeId: string; maskId: string; seq: number } | null>(null);
  const refreshGitStatus = (): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    void getHost()
      .gitStatus(ws.projectPath)
      .then((out) => {
        const map = new Map<string, ScmDecoration>();
        for (const e of parseGitPorcelainZ(out)) {
          const deco = scmDecoration(e.x, e.y);
          if (deco) map.set(joinPath(ws.projectPath, e.path), deco);
        }
        setGitDecorations(map);
      })
      .catch(() => setGitDecorations(new Map()));
  };
  const refreshGitRef = useRef(refreshGitStatus);
  refreshGitRef.current = refreshGitStatus;
  useEffect(() => {
    const onFocus = (): void => refreshGitRef.current();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    refreshGitRef.current(); // on project open/change
  }, [workspace]);

  const reconcileRename = (from: string, to: string): void => {
    setTimeout(() => refreshGitRef.current(), 50); // after the tree settles
    const ws = workspaceRef.current;
    if (!ws) return;
    let changed = false;
    for (const t of ws.tabs) {
      const p = tabPath(t);
      if (!p) continue;
      const next = p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : null;
      if (!next) continue;
      if (t.kind === "doc") {
        t.docPath = next;
        t.store.setDocPath(next);
      } else {
        t.path = next;
      }
      changed = true;
    }
    if (changed) ws.notify();
  };
  const reconcileDelete = (paths: string[]): void => {
    setTimeout(() => refreshGitRef.current(), 50); // after the tree settles

    const ws = workspaceRef.current;
    if (!ws) return;
    const gone = (p: string): boolean => paths.some((d) => p === d || p.startsWith(d + "/"));
    let keptDirty = 0;
    for (const t of [...ws.tabs]) {
      const p = tabPath(t);
      if (!p || !gone(p)) continue;
      // a clean tab can be closed silently; a DIRTY tab whose .lmb was deleted from the explorer keeps
      // its unsaved work — closing it here (as before) bypassed the dirty guard and lost it. Leave it
      // open so Save re-creates the file (or the close guard prompts); just flag it.
      if (t.kind === "doc" && t.store.state.dirty) keptDirty += 1;
      else ws.closeTab(t.id);
    }
    if (keptDirty > 0) {
      notify(
        `${keptDirty} deleted document${keptDirty === 1 ? "" : "s"} kept open with unsaved changes — Save to restore`,
        "error",
      );
    }
  };

  // source chosen → write the .lmb ONLY if the diffuse resolves + decodes; otherwise leave no file
  const createDocAt = (path: string, uri: string): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    run(
      (async () => {
        // never clobber an existing .lmb with a blank doc — the explorer's inline namer does no collision
        // check, so a name that already exists would otherwise silently overwrite a real document
        if (await getHost().pathExists(path)) {
          throw new Error(`${basename(path)} already exists — pick a different name`);
        }
        // in-project sources are stored project-relative so the .lmb is portable across clones
        const portable = relativizeSourceUri(uri, ws.projectPath);
        const bytes = await resolveDiffuse(getHost(), portable, { baseDir: ws.projectPath }); // throws on bad source → nothing written
        const d = decode(bytes); // validates it's a real image; records dims
        await getHost().writeFile(path, new TextEncoder().encode(serializeDoc(emptyDoc(portable, d.width, d.height))));
        const { tab } = await openDocTab(getHost(), path, ws.projectPath); // fresh emptyDoc → no unknown layers to drop
        const prevView = (ws.active && viewsRef.current[ws.active.id]) || DEFAULT_VIEW;
        setViews((vs) => ({ ...vs, [tab.id]: { ...prevView } }));
        ws.openTab(tab);
        return `Created ${basename(path)}`;
      })(),
    );
  };

  // Files dropped onto the WINDOW — the DnD twin of the argv/file-association path:
  // project folder / project.lambert opens the project; .lmb opens a tab (resolving its project
  // first if none is open); .png becomes a new document over that diffuse in the current project.
  const handleDroppedPath = async (path: string): Promise<string | undefined> => {
    const host = getHost();
    const openDocIn = async (lmb: string): Promise<string | undefined> => {
      if (!workspaceRef.current) {
        // no project open: walk up from the .lmb to its project.lambert and enter that project
        let dir = dirname(lmb);
        for (;;) {
          if (await host.pathExists(joinPath(dir, PROJECT_FILE))) break;
          const parent = dirname(dir);
          if (parent === dir) throw new Error(`${basename(lmb)} isn't inside a Lambert project (no ${PROJECT_FILE} above it)`);
          dir = parent;
        }
        enterProject(await openProjectByPath(host, dir));
      }
      openDoc(lmb);
      return undefined; // openDoc reports its own status
    };
    if (basename(path) === PROJECT_FILE) return (await enterProjectRouted(await openProjectByPath(host, dirname(path)))) ?? undefined;
    if (/\.lmb$/i.test(path)) return openDocIn(path);
    if (/\.png$/i.test(path)) {
      const ws = workspaceRef.current;
      if (!ws) throw new Error("Open a project first — a dropped .png becomes a new document in it");
      // non-colliding <stem>.lmb at the project root, then the normal create path (validates the png)
      const stem = basename(path).replace(/\.(df\.)?png$/i, "");
      let lmb = joinPath(ws.projectPath, `${stem}.lmb`);
      for (let n = 2; await host.pathExists(lmb); n++) lmb = joinPath(ws.projectPath, `${stem}-${n}.lmb`);
      createDocAt(lmb, `file://${path}`);
      return undefined;
    }
    // anything else: a directory is a project candidate; otherwise reject clearly
    if (await host.pathExists(joinPath(path, PROJECT_FILE))) return (await enterProjectRouted(await openProjectByPath(host, path))) ?? undefined;
    throw new Error(`${basename(path)} isn't something Lambert opens (drop a project folder, .lmb, or .png)`);
  };
  const handleDroppedPathRef = useRef(handleDroppedPath);
  handleDroppedPathRef.current = handleDroppedPath;
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDropFiles = (e: DragEvent): void => {
      const file = e.dataTransfer?.files[0];
      if (!file) return; // in-app drags (palette objects) keep their own handlers
      e.preventDefault();
      const path = getHost().pathForFile(file);
      if (path) run(handleDroppedPathRef.current(path));
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDropFiles);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDropFiles);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload the active doc's diffuse from its source (refresh remote cache), re-validating dims —
  // a size change offers the adopt/scale migration instead of refusing
  const reloadDiffuse = (): void => {
    const ws = workspaceRef.current;
    const t = ws?.active;
    if (!ws || t?.kind !== "doc") return;
    run(
      (async () => {
        const doc = t.store.state.doc;
        const bytes = await resolveDiffuse(getHost(), doc.source.uri, { refresh: true, baseDir: ws.projectPath });
        const d = decode(bytes);
        if (d.width !== doc.source.width || d.height !== doc.source.height) {
          setResizeAsk({ kind: "reload", tabId: t.id, bytes, width: d.width, height: d.height, oldW: doc.source.width, oldH: doc.source.height });
          return undefined;
        }
        t.diffuse.bytes = bytes; // new array → preview's WeakMap<bytes,tex> cache misses → re-decode
        t.diffuse.unresolved = false; // a successful relink clears the placeholder/relink state
        ws.notify();
        return "Reloaded diffuse";
      })(),
    );
  };

  const closeDoc = async (id: string): Promise<void> => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const t = ws.tabs[ws.indexById(id)];
    if (t?.kind === "doc" && t.store.state.dirty) {
      const name = t.docPath ? basename(t.docPath) : "Untitled document";
      const r = await confirm({
        title: `${name} has unsaved changes`,
        message: "Close anyway? Your unsaved changes will be lost.",
        confirmLabel: "Close",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (r !== "confirm") return;
    }
    ws.closeTab(id);
  };

  const saveActive = (): void => {
    const ws = workspaceRef.current;
    const t = ws?.active;
    if (!ws || t?.kind !== "doc") return;
    saveTab(getHost(), t, ws.projectPath)
      .then((p) => {
        if (p) notify(`Saved ${basename(p)}`); // null = save-as dialog cancelled
        refreshGitStatus();
      })
      .catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), "error"));
  };

  const saveAll = (): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    void (async () => {
      const dirty = ws.tabs.filter((t): t is DocTab => t.kind === "doc" && t.store.state.dirty);
      let saved = 0;
      let failed = 0;
      // per-tab try/catch: one failing save must not abort the rest (the old loop threw on the first
      // error, leaving later dirty tabs unsaved and reporting a misleading count)
      for (const t of dirty) {
        try {
          if (await saveTab(getHost(), t, ws.projectPath)) saved += 1; // null = save-as dialog cancelled
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) notify(`Saved ${saved}, failed ${failed}`, "error");
      else notify(`Saved ${saved} file${saved === 1 ? "" : "s"}`);
      refreshGitStatus();
    })();
  };

  const exportActive = (): void => {
    if (sidecarRef.current) {
      exportActiveRemote(); // remote projects upload straight to the server
      return;
    }
    const ws = workspaceRef.current;
    const t = ws?.active;
    if (!ws || t?.kind !== "doc") return;
    // an unresolved-diffuse tab carries a blank placeholder, so its alpha (mask) gate would be wrong —
    // block export until the real diffuse is relinked
    if (t.diffuse.unresolved) {
      notify("Relink the diffuse (Reload Diffuse) before exporting — this document has no diffuse loaded", "error");
      return;
    }
    if (!t.docPath) {
      notify("Save the document before exporting its NX", "error");
      return;
    }
    // OS save dialog defaulting into <project>/dist/ (created on demand); null = cancelled
    void (async () => {
      const output = effectiveOutput(t.store.state.doc, ws.config);
      const exportsDir = joinPath(ws.projectPath, "dist");
      await getHost().mkdir(exportsDir).catch(() => {});
      const out = await getHost().saveDialog({
        title: "Export NX",
        defaultPath: joinPath(exportsDir, basename(t.docPath!).replace(/\.lmb$/i, "") + nxExtension(output)),
        filters: [{ name: "NX normal map", extensions: [output.format] }],
      });
      if (!out) return;
      run(exportTabNx(getHost(), t, ws.config, out, ws.projectPath).then((r) => { refreshGitStatus(); return r; }));
    })();
  };

  /** Every .lmb in the project (recursive), skipping dotdirs and the dist output folder. */
  const collectProjectLmbs = async (projectPath: string): Promise<string[]> => {
    const lmbs: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await carapaceHost.fs!.list(dir).catch(() => []);
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "dist") continue; // .git, dotfiles, export output
        if (e.isDir) await walk(e.path);
        else if (/\.lmb$/i.test(e.name)) lmbs.push(e.path);
      }
    };
    await walk(projectPath);
    return lmbs;
  };

  // Remote projects: Export NX renders as usual, writes the NX beside the sources at the project
  // root (the remote is flat; Sync would mirror it there anyway), then uploads it with the usual
  // If-Match discipline and records it in the sidecar so the next Sync doesn't re-download it.
  const exportActiveRemote = (): void => {
    const ws = workspaceRef.current;
    const t = ws?.active;
    if (!ws || t?.kind !== "doc") return;
    if (t.diffuse.unresolved) {
      notify("Relink the diffuse (Reload Diffuse) before exporting — this document has no diffuse loaded", "error");
      return;
    }
    if (!t.docPath) {
      notify("Save the document before exporting its NX", "error");
      return;
    }
    run(
      (async () => {
        const output = effectiveOutput(t.store.state.doc, ws.config);
        const out = joinPath(ws.projectPath, basename(t.docPath!).replace(/\.lmb$/i, "") + nxExtension(output));
        const file = await renderDocNx(getHost(), t.store.state.doc, t.docPath!, ws.config, out, ws.projectPath);
        await getHost().writeFile(file.path, file.bytes);
        const pushed = await pushRendered([basename(file.path)]);
        if (pushed !== null) return pushed;
        return file.warning ? `Exported ${basename(file.path)} to remote — WARNING: ${file.warning}` : `Exported ${basename(file.path)} to remote`;
      })(),
    );
  };

  const exportAllRemote = (): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    run(
      (async () => {
        const lmbs = await collectProjectLmbs(ws.projectPath);
        if (lmbs.length === 0) {
          notify("Nothing to export — the project has no .lmb documents", "error");
          return;
        }
        const liveDocs = new Map(ws.tabs.filter((t): t is DocTab => t.kind === "doc" && t.docPath !== null).map((t) => [t.docPath!, t.store.state.doc]));
        const names: string[] = [];
        const renderFailed: string[] = [];
        for (const lmb of lmbs) {
          try {
            const doc = liveDocs.get(lmb) ?? parseDoc(new TextDecoder().decode(await getHost().readFile(lmb)));
            const ext = nxExtension(effectiveOutput(doc, ws.config));
            const out = joinPath(ws.projectPath, basename(lmb).replace(/\.lmb$/i, "") + ext);
            const file = await renderDocNx(getHost(), doc, lmb, ws.config, out, ws.projectPath);
            await getHost().writeFile(file.path, file.bytes);
            names.push(basename(file.path));
          } catch {
            renderFailed.push(basename(lmb));
          }
        }
        const pushed = names.length > 0 ? await pushRendered(names, { summarize: true }) : null;
        const parts = [pushed, countPart(renderFailed.length, "failed to render")].filter((x): x is string => x !== null && x.length > 0);
        return `Export: ${parts.length ? parts.join(", ") : "nothing rendered"}`;
      })(),
    );
  };

  /** Upload freshly rendered NX files and persist the sidecar. Single-name mode returns null on
   *  clean success (the caller words the message); summarize mode returns the counts string. */
  const pushRendered = async (names: string[], opts?: { summarize?: boolean }): Promise<string | null> => {
    const conn = remoteConnection();
    const ws = workspaceRef.current;
    if (!conn || !ws) return "Remote connection lost — check Preferences > Remote Servers";
    const dav = makeDavClient(davTransport(getHost()), conn.server);
    const io = localIo(getHost(), (d) => carapaceHost.fs!.list(d), ws.projectPath);
    const { sidecar: next, summary } = await runPushNamed(dav, conn.sc, io, remoteSyncUi("Uploading"), names);
    await saveSidecar(sidecarIo(getHost()), ws.projectPath, next);
    setSidecar(next);
    if (opts?.summarize) {
      const parts = [
        countPart(summary.uploaded.length, "uploaded"),
        countPart(summary.skipped.length, "unchanged"),
        countPart(summary.blocked.length, "blocked — Sync first"),
        countPart(summary.failed.length, "failed"),
      ].filter((p): p is string => p !== null);
      return parts.join(", ");
    }
    if (summary.blocked.length) return `${summary.blocked[0]} changed on the server — Sync from Remote first`;
    if (summary.failed.length) return `Failed to upload ${summary.failed[0]!.name}: ${summary.failed[0]!.error}`;
    return null;
  };

  // height-map export: the authored height field as 16-bit grayscale, next to Export NX
  const exportHeightmap = (): void => {
    const ws = workspaceRef.current;
    const t = ws?.active;
    if (!ws || t?.kind !== "doc") return;
    if (!t.docPath) {
      notify("Save the document before exporting its height map", "error");
      return;
    }
    void (async () => {
      const exportsDir = joinPath(ws.projectPath, "dist");
      await getHost().mkdir(exportsDir).catch(() => {});
      const out = await getHost().saveDialog({
        title: "Export Height Map",
        defaultPath: joinPath(exportsDir, basename(t.docPath!).replace(/\.lmb$/i, "") + ".height.png"),
        filters: [{ name: "Height map (16-bit grayscale)", extensions: ["png"] }],
      });
      if (!out) return;
      run(exportTabHeightmap(getHost(), t, ws.config, out).then((r) => { refreshGitStatus(); return r; }));
    })();
  };

  // batch NX export: EVERY .lmb in the project (recursive walk), not just open tabs. An open tab
  // exports its LIVE doc (what you see is what you get, unsaved edits included); closed files parse
  // from disk. One OS folder picker for the whole batch, defaulting to <project>/dist/.
  const exportAll = (): void => {
    if (sidecarRef.current) {
      exportAllRemote();
      return;
    }
    const ws = workspaceRef.current;
    if (!ws) return;
    void (async () => {
      const lmbs = await collectProjectLmbs(ws.projectPath);
      if (lmbs.length === 0) {
        notify("Nothing to export — the project has no .lmb documents", "error");
        return;
      }
      const exportsDir = joinPath(ws.projectPath, "dist");
      await getHost().mkdir(exportsDir).catch(() => {});
      const dir = await getHost().openFolderDialog({ title: "Export all NX to folder", defaultPath: exportsDir });
      if (!dir) return;
      const liveDocs = new Map(ws.tabs.filter((t): t is DocTab => t.kind === "doc" && t.docPath !== null).map((t) => [t.docPath!, t.store.state.doc]));
      run(
        Promise.allSettled(
          lmbs.map(async (lmb) => {
            const doc = liveDocs.get(lmb) ?? parseDoc(new TextDecoder().decode(await getHost().readFile(lmb)));
            const ext = nxExtension(effectiveOutput(doc, ws.config)); // per-doc override may change the container
            return exportDocNx(getHost(), doc, lmb, ws.config, joinPath(dir, basename(lmb).replace(/\.lmb$/i, "") + ext), ws.projectPath);
          }),
        ).then((results) => {
          refreshGitStatus();
          const ok = results.filter((r) => r.status === "fulfilled").length;
          const failed = results.length - ok;
          const parts = [`Exported ${ok} of ${lmbs.length} NX file${lmbs.length === 1 ? "" : "s"}`];
          if (failed > 0) {
            const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
            parts.push(`${failed} failed${first ? ` (${first.reason instanceof Error ? first.reason.message : String(first.reason)})` : ""}`);
          }
          return parts.join(", ");
        }),
      );
    })();
  };

  // --- remote projects: sync (pull) / export (push) against the project's WebDAV server ---
  // Runners + conflict semantics live in src/remote (fixture-tested); this is IO/UI binding only.

  /** Resolve the open remote project's server entry + sidecar, or explain what's missing. Falls
   *  back to matching by baseUrl: entry ids are random, so a deleted-and-re-added server heals. */
  const remoteConnection = (): { server: RemoteServer; sc: Sidecar } | null => {
    const sc = sidecarRef.current;
    if (!sc) return null; // commands are disabled without a sidecar; belt-and-braces
    const server = remoteServers.find((s) => s.id === sc.serverId) ?? remoteServers.find((s) => s.baseUrl === sc.baseUrl);
    if (!server) {
      notify(`This project's remote server is missing — re-add ${sc.baseUrl} in Preferences > Remote Servers`, "error");
      return null;
    }
    return { server, sc };
  };

  const remoteSyncUi = (verb: string): SyncUi => ({
    progress: (name, done, total) => setStatus({ text: `${verb} ${name} (${done}/${total})`, tone: "info" }),
    confirmOverwriteLocal: async (name) =>
      (await confirm({
        title: `${name} changed on the server and locally`,
        message: "Overwrite your local copy with the server version? Your local edits to this file will be lost.",
        confirmLabel: "Overwrite local",
        cancelLabel: "Keep mine",
        danger: true,
      })) === "confirm",
    info: (m) => notify(m),
  });

  /** Count fragments like "3 new" — only non-zero parts make the summary. */
  const countPart = (n: number, label: string): string | null => (n > 0 ? `${n} ${label}` : null);

  const remoteSync = (): void => {
    const conn = remoteConnection();
    const ws = workspaceRef.current;
    if (!conn || !ws) return;
    run(
      (async () => {
        const dav = makeDavClient(davTransport(getHost()), conn.server);
        const io = localIo(getHost(), (d) => carapaceHost.fs!.list(d), ws.projectPath);
        const { sidecar: next, summary } = await runPull(dav, conn.sc, io, remoteSyncUi("Syncing"));
        await saveSidecar(sidecarIo(getHost()), ws.projectPath, next);
        setSidecar(next);
        refreshGitStatus();
        const parts = [
          countPart(summary.downloaded.length, "downloaded"),
          countPart(summary.fastForwarded.length, "updated"),
          countPart(summary.conflictsOverwritten.length, "overwritten"),
          countPart(summary.conflictsKept.length, "kept (conflict)"),
          countPart(summary.keptLocal.length, "local ahead"),
          countPart(summary.failed.length, "failed"),
        ].filter((p): p is string => p !== null);
        return `Sync: ${parts.length ? parts.join(", ") : "everything up to date"}`;
      })(),
    );
  };

  const remoteExport = (): void => {
    const conn = remoteConnection();
    const ws = workspaceRef.current;
    if (!conn || !ws) return;
    run(
      (async () => {
        const dav = makeDavClient(davTransport(getHost()), conn.server);
        const io = localIo(getHost(), (d) => carapaceHost.fs!.list(d), ws.projectPath);
        const { sidecar: next, summary } = await runPush(dav, conn.sc, io, remoteSyncUi("Uploading"));
        await saveSidecar(sidecarIo(getHost()), ws.projectPath, next);
        setSidecar(next);
        const parts = [
          countPart(summary.uploaded.length, "uploaded"),
          countPart(summary.skipped.length, "unchanged"),
          countPart(summary.blocked.length, "blocked — Sync first"),
          countPart(summary.failed.length, "failed"),
        ].filter((p): p is string => p !== null);
        return `Export: ${parts.length ? parts.join(", ") : "nothing to export"}`;
      })(),
    );
  };

  // update + persist project.lambert (normal dirs, saved presets, ...)
  const persistConfig = (config: ProjectConfig): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    ws.setConfig(config);
    void getHost().writeFile(
      joinPath(ws.projectPath, PROJECT_FILE),
      new TextEncoder().encode(serializeProjectConfig(config)),
    );
  };

  // Explorer root-row rename -> the project display name in project.lambert (empty = clear back
  // to the directory default). Never available on remote clones (the server owns the name).
  const renameProject = (name: string): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    persistConfig({ ...ws.config, name: name.trim() || undefined });
  };

  // open one of the settings dialogs, optionally at a screen (defaults to its last-viewed one)
  const openSettingsDialog = (dialog: SettingsDialogKind, screen?: string): void => {
    if (!workspaceRef.current) return;
    if (dialog === "doc" && !workspaceRef.current.active) return;
    if (screen) ({ prefs: setPrefsScreen, project: setProjectScreen, doc: setDocScreen })[dialog](screen);
    setSettingsOpen(dialog);
  };
  // deep-link entry: the screen id encodes which dialog it lives in
  const openSettings = (screen: string): void => openSettingsDialog(settingsDialogFor(screen), screen);

  /** Instantiate a saved preset template: deep-clone (the store must never alias the template),
   *  hydrate the plain-JSON vectors, fresh id, drop-point position (z/elevation kept). */
  const instantiateSaved = (sp: SavedPreset, pos: Vector2): ObjectInstance => {
    const o = hydrateObjectRaw(JSON.parse(JSON.stringify(sp.object)));
    o.id = crypto.randomUUID();
    o.transform = { ...o.transform, pos: new Vector3(pos.x, pos.y, o.transform.pos.z) };
    return o;
  };

  /** Palette id -> a fresh instance: user-saved presets (project.lambert) first, then the built-in
   *  identity tiles (createFromPreset). Shared by the popover pick and the canvas drag-drop. */
  const resolvePaletteObject = (presetId: string, pos: Vector2): ObjectInstance => {
    const sp = workspaceRef.current?.config.presets?.find((x) => x.id === presetId);
    const o = sp ? instantiateSaved(sp, pos) : createFromPreset(presetId, pos);
    // adjustment layers default to the FULL image bounds regardless of the drop point —
    // a filter region over everything below, not a placed shape
    if (o.typeId === ObjectTypeId.Adjust) {
      const a = workspaceRef.current?.active;
      const doc = a?.kind === "doc" ? a.store.state.doc : undefined;
      if (doc) {
        const hw = doc.source.width / 2;
        const hh = doc.source.height / 2;
        o.transform = { ...o.transform, pos: new Vector3(hw, hh, o.transform.pos.z) };
        const c = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
        const box = [c(-hw, -hh), c(hw, -hh), c(hw, hh), c(-hw, hh)];
        const baked = bakeRings(box, undefined);
        o.bezier = box;
        o.closed = true;
        o.controlPoints = baked.controlPoints;
        o.ringSplit = baked.ringSplit;
        o.contourCounts = baked.contourCounts;
      }
    }
    return o;
  };

  // add an object from the library popover (a palette preset), at the document origin
  const pickObject = (presetId: string): void => {
    const t = workspaceRef.current?.active;
    if (t?.kind !== "doc") return;
    const o = t.store.state.doc.canvas.origin;
    const instance = resolvePaletteObject(presetId, v2(o.x, o.y));
    // group-aware: a selected group (or an object inside one) receives the new object
    t.store.update((d) => addInstanceNear(d, instance, t.store.state.selectedId));
    t.store.select(instance.id);
    t.store.endGesture();
  };

  // save the primary selected object as a project preset (project.lambert -> the palette's Project group)
  const savePresetFromSelection = (): void => {
    const ws = workspaceRef.current;
    const t = ws?.active;
    if (!ws || t?.kind !== "doc") return;
    const node = t.store.state.selectedId ? findNode(t.store.state.doc.layers, t.store.state.selectedId) : null;
    if (!node || !isObject(node)) {
      notify("Select an object to save as a preset (groups aren't supported yet)", "error");
      return;
    }
    // deep-clone via JSON (same round-trip as .lmb save) and neutralize instance-only state
    const template = JSON.parse(JSON.stringify(node)) as SavedPreset["object"];
    template.visible = true;
    template.locked = false;
    const existing = ws.config.presets ?? [];
    const base = node.name ?? getObjectType(node.typeId).name;
    let name = base;
    for (let n = 2; existing.some((p) => p.name === name); n++) name = `${base} ${n}`;
    persistConfig({ ...ws.config, presets: [...existing, { id: crypto.randomUUID(), name, object: template }] });
    notify(`Saved preset "${name}"`);
  };

  const deletePreset = (id: string): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    persistConfig({ ...ws.config, presets: (ws.config.presets ?? []).filter((p) => p.id !== id) });
  };

  const exportPresets = (): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const presets = ws.config.presets ?? [];
    if (presets.length === 0) {
      notify("No saved presets to export", "error");
      return;
    }
    run(
      (async () => {
        const path = await getHost().saveDialog({
          title: "Export Presets",
          defaultPath: "presets.lambert-presets.json",
          filters: [{ name: "Lambert presets", extensions: ["json"] }],
        });
        if (!path) return undefined;
        const payload = JSON.stringify({ schemaVersion: 1, presets }, null, 2) + "\n";
        await getHost().writeFile(path, new TextEncoder().encode(payload));
        return `Exported ${presets.length} preset${presets.length === 1 ? "" : "s"}`;
      })(),
    );
  };

  const importPresets = (): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    run(
      (async () => {
        const path = await getHost().openDialog({
          title: "Import Presets",
          filters: [{ name: "Lambert presets", extensions: ["json"] }],
        });
        if (!path) return undefined;
        const lib = presetLibrarySchema.parse(JSON.parse(new TextDecoder().decode(await getHost().readFile(path))));
        const existing = ws.config.presets ?? [];
        // fresh ids on import (no collisions with the local library); names deduped like save
        const names = new Set(existing.map((p) => p.name));
        const incoming = lib.presets.map((p) => {
          let name = p.name;
          for (let n = 2; names.has(name); n++) name = `${p.name} ${n}`;
          names.add(name);
          return { ...p, id: crypto.randomUUID(), name };
        });
        persistConfig({ ...ws.config, presets: [...existing, ...incoming] });
        return `Imported ${incoming.length} preset${incoming.length === 1 ? "" : "s"}`;
      })(),
    );
  };

  const buildStash = (): string | null => {
    const ws = workspaceRef.current;
    if (!ws) return null;
    const vs = viewsRef.current;
    const vpts = viewportsRef.current;
    const obs = orbitsRef.current;
    return buildSessionJson({
      projectPath: ws.projectPath,
      activeIndex: ws.activeIndex,
      tabs: ws.tabs.map((t) =>
        t.kind === "image"
          ? { kind: "image" as const, id: t.id, path: t.path, pinned: t.pinned }
          : {
              kind: "doc" as const,
              id: t.id,
              docPath: t.docPath,
              dirty: t.store.state.dirty,
              doc: t.store.state.doc,
              view: vs[t.id] ?? DEFAULT_VIEW,
              selectedId: t.store.state.selectedId,
              viewport: vpts[t.id],
              orbit: obs[t.id],
              pinned: t.pinned,
            },
      ),
    });
  };

  // Batch close (menu verbs / commands): sequential so each dirty tab gets its own confirm; a
  // cancel skips just that tab.
  const closeMany = async (ids: string[]): Promise<void> => {
    for (const id of ids) await closeDoc(id);
  };

  // Pin/unpin + keep the strip pinned-first (the host owns tab ordering; carapace just renders).
  const setTabPinned = (id: string, pinned: boolean): void => {
    const ws = workspaceRef.current;
    const t = ws?.tabs[ws.indexById(id)];
    if (!ws || !t) return;
    t.pinned = pinned || undefined;
    ws.notify(); // pinned alone changes rendering even when the order is already right
    ws.moveTab(id, ws.tabs.filter((x) => x.pinned && x.id !== id).length);
  };

  // application-menu actions — shared by the OS-menu accelerators (via onMenuAction) and the
  // in-window MenuBar (the menuModel built below). Defined in render so it sees fresh state; the
  // IPC listener calls the latest via a ref so it registers only once.
  const runMenuAction = (action: string): void => {
    const anyTab = workspaceRef.current?.active;
    const t = anyTab?.kind === "doc" ? anyTab : undefined; // doc-only actions guard on this
    const ids = t?.store.state.selectedIds ?? [];
    switch (action) {
      case "new-project":
        return openProject("new");
      case "open-project":
        return openProject("open");
      case "new-document":
        return newDocument();
      case "reload-diffuse":
        return reloadDiffuse();
      case "save":
        return saveActive();
      case "save-all":
        return saveAll();
      case "export-nx":
        return exportActive();
      case "export-height":
        return exportHeightmap();
      case "export-all":
        return exportAll();
      case "remote-clone":
        return setRemoteCloneOpen(true);
      case "remote-sync":
        return remoteSync();
      case "remote-export":
        return remoteExport();
      case "save-preset":
        return savePresetFromSelection();
      case "import-presets":
        return importPresets();
      case "export-presets":
        return exportPresets();
      case "undo":
        return t?.store.undo();
      case "redo":
        return t?.store.redo();
      case "duplicate":
        if (t && ids.length) {
          t.store.commit((d) => ids.reduce((acc, sid) => duplicateObject(acc, sid), d));
        }
        return;
      case "delete":
        if (t && ids.length) {
          t.store.commit((d) => ids.reduce((acc, sid) => removeObject(acc, sid), d));
        }
        return;
      case "copy":
        if (t && ids.length) {
          objectClipboard = ids
            .map((sid) => findNode(t.store.state.doc.layers, sid))
            .filter((n): n is LayerNode => n !== null);
        }
        return;
      case "paste":
        if (t && objectClipboard.length) {
          // deep-clone each with fresh ids AT THE SAME POSITION (paste-in-place; the layer panel +
          // selection highlight disambiguate the copy), add at top level, and select the new copies
          const clones = objectClipboard.map((n) => cloneNode(n, 0, 0));
          t.store.commit((d) => clones.reduce((acc, c) => ({ ...acc, layers: addNode(acc.layers, c, null) }), d));
          t.store.setSelection(clones.map((c) => c.id));
        }
        return;
      case "group":
        if (t && ids.length) {
          const gid = crypto.randomUUID();
          t.store.commit((d) => ({ ...d, layers: wrapInGroup(d.layers, ids, gid, d.canvas.origin) }));
          t.store.select(gid);
        }
        return;
      case "ungroup":
        if (t && ids.length) {
          // dissolve each selected group (non-groups + shear-blocked ones are left as-is)
          t.store.update((d) =>
            ids.reduce((acc, sid) => {
              const n = findNode(acc.layers, sid);
              if (!n || !isGroup(n)) return acc;
              const next = ungroup(acc.layers, sid);
              return next ? { ...acc, layers: next } : acc;
            }, d),
          );
          t.store.endGesture();
        }
        return;
      case "align-left":
      case "align-hcenter":
      case "align-right":
      case "align-top":
      case "align-vcenter":
      case "align-bottom":
        if (t && ids.length >= 2) {
          const mode = action.slice("align-".length) as AlignMode;
          t.store.commit((d) => ({ ...d, layers: alignNodes(d.layers, ids, mode) }));
        }
        return;
      case "distribute-h":
      case "distribute-v":
        if (t && ids.length >= 3) {
          t.store.commit((d) => ({ ...d, layers: distributeNodes(d.layers, ids, action === "distribute-h" ? "h" : "v") }));
        }
        return;
      case "flip-h":
      case "flip-v":
        // mirror each selected node about its own centre (negate one scale axis)
        if (t && ids.length) {
          t.store.commit((d) => ({
            ...d,
            layers: ids.reduce(
              (ls, sid) =>
                updateNode(ls, sid, (n) => ({
                  ...n,
                  transform: {
                    ...n.transform,
                    scale: action === "flip-h" ? n.transform.scale.withX(-n.transform.scale.x) : n.transform.scale.withY(-n.transform.scale.y),
                  },
                })),
              d.layers,
            ),
          }));
        }
        return;
      case "order-front":
      case "order-back":
        if (t && ids.length) {
          t.store.commit((d) => ids.reduce((dd, sid) => reorderObject(dd, sid, action === "order-front" ? +1 : -1), d));
        }
        return;
      case "order-top":
      case "order-bottom":
        if (t && ids.length) {
          t.store.commit((d) =>
            ids.reduce((dd, sid) => moveObjectTo(dd, sid, action === "order-top" ? siblingsOf(dd.layers, sid).length - 1 : 0), d),
          );
        }
        return;
      case "deselect":
        if (t) {
          setSelVerts([]);
          t.store.select(null);
        }
        return;
      case "close-tab":
      case "close-others":
      case "close-right":
      case "close-saved":
      case "close-all": {
        const ws = workspaceRef.current;
        if (!ws || !anyTab) return;
        const verb = (action === "close-tab" ? "close" : action) as Exclude<TabMenuVerb, "pin">;
        const infos = ws.tabs.map((x) => ({ id: x.id, title: "", dirty: x.kind === "doc" && x.store.state.dirty, pinned: x.pinned }));
        void closeMany(tabVerbIds(verb, infos, anyTab.id));
        return;
      }
      case "pin-tab":
        if (anyTab) setTabPinned(anyTab.id, !anyTab.pinned);
        return;
      case "tab-next":
      case "tab-prev": {
        const ws = workspaceRef.current;
        if (!ws || !anyTab || ws.tabs.length < 2) return;
        const cur = ws.indexById(anyTab.id);
        ws.focus(ws.tabs[(cur + (action === "tab-next" ? 1 : ws.tabs.length - 1)) % ws.tabs.length]!.id);
        return;
      }
      case "zoom-fit":
      case "zoom-100":
      case "zoom-fit-selection":
      case "zoom-in":
      case "zoom-out":
        window.dispatchEvent(new CustomEvent("lambert-zoom", { detail: action }));
        return;
      case "toggle-rulers":
        return setRulers((r) => !r);
      case "toggle-pixel-grid":
        return setPixelGrid((g) => !g);
      case "preferences":
        return openSettingsDialog("prefs");
      case "project-settings":
        return openSettingsDialog("project");
      case "document-settings":
        return openSettingsDialog("doc");
      case "rename":
        // Layers owns the rename UI — same window-event pattern as lambert-zoom
        window.dispatchEvent(new Event("lambert-rename"));
        return;
      case "command-palette":
        return setPaletteOpen(true);
      case "view-cycle":
        return setActiveView((s) => ({ ...s, mode: VIEW_MODES[(VIEW_MODES.indexOf(s.mode) + 1) % VIEW_MODES.length]!, prevMode: s.mode }));
      case "view-toggle-last":
        return setActiveView((s) => {
          const back = s.prevMode ?? (s.mode === "normal" ? "diffuse" : "normal");
          return back === s.mode ? s : { ...s, mode: back, prevMode: s.mode };
        });
      case "view-swap":
        return setSwapped((sw) => !sw);
    }
    // canvas tools (palette / rebound keys route here; the keymap also dispatches tool-*)
    if (action.startsWith("tool-")) setTool(action.slice("tool-".length) as ToolMode);
  };
  const runMenuActionRef = useRef(runMenuAction);
  runMenuActionRef.current = runMenuAction;
  useEffect(() => {
    getHost().onMenuAction((a) => runMenuActionRef.current(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Command registry (the palette's backing store): every command, enablement mirrored from the
  // menu capability flags via refs so the closures never go stale. Rebuilt only on rebind.
  const registry = useMemo(
    () =>
      createCommandRegistry(
        COMMANDS.filter((c) => c.enable !== "never").map((c) => ({
          id: c.id,
          label: c.label,
          category: c.category,
          keybinding: bindings.get(c.id) ?? undefined,
          isEnabled: () => {
            const ws = workspaceRef.current;
            const anyTab = ws?.active;
            const t = anyTab?.kind === "doc" ? anyTab : undefined;
            const n = t?.store.state.selectedIds.length ?? 0;
            switch (c.enable) {
              case "always":
                return true;
              case "workspace":
                return !!ws;
              case "active":
                return !!anyTab;
              case "doc":
                return !!t;
              case "sel":
                return n > 0;
              case "align":
                return n >= 2;
              case "distribute":
                return n >= 3;
              case "undo":
                return !!t?.store.canUndo;
              case "redo":
                return !!t?.store.canRedo;
              case "presets":
                return (ws?.config.presets?.length ?? 0) > 0;
              case "remote":
                return sidecarRef.current !== null;
              default:
                return false;
            }
          },
          run: () => runMenuActionRef.current(c.id),
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bindings],
  );

  // close guard: confirm when any tab is dirty, and flush the session stash before closing
  useEffect(() => {
    const host = getHost();
    host.guardClose();
    host.onConfirmClose(async () => {
      const ws = workspaceRef.current;
      const anyDirty = ws?.tabs.some((t) => t.kind === "doc" && t.store.state.dirty) ?? false;
      let ok = true;
      if (anyDirty) {
        const r = await confirm({
          title: "Unsaved changes",
          message: "Close anyway? Your unsaved changes will be recovered the next time you open Lambert.",
          confirmLabel: "Close",
          cancelLabel: "Cancel",
          danger: true,
        });
        ok = r === "confirm";
      }
      const stash = ok ? buildStash() : null;
      if (stash) void host.saveSession(stash).finally(() => host.respondClose(true));
      else host.respondClose(ok);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // session restore (+ OS open): reopen the last project and its tabs — unless the OS handed us a
  // project to open (double-clicked project.lambert), which wins. Also register the live "open with"
  // push so an already-running window opens a freshly double-clicked project.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("demo")) return;
    // capture/e2e aid: `?open=<project dir>` opens a real on-disk project instead of restoring the
    // session (automation profiles are fresh, so there is no session); `&openimage=<relpath>`
    // then opens an image tab from it — used for --capture shots of the explorer/ImageView.
    const openQ = params.get("open");
    if (openQ) {
      void (async () => {
        try {
          notify(enterProject(await openProjectByPath(getHost(), openQ)));
          const img = params.get("openimage");
          if (img) setTimeout(() => openImageTab(joinPath(openQ, img)), 100);
        } catch (err) {
          notify(err instanceof Error ? err.message : String(err), "error");
        }
      })();
      return;
    }
    getHost().onOpenProjectPath((dir) => openPathRef.current(dir));
    void (async () => {
      try {
        const host = getHost();
        const pending = await host.takePendingOpen();
        if (pending) {
          // Await the OS-handed open instead of fire-and-forget: if it fails (dead/removed project),
          // fall through to restore the prior session rather than stranding the user on an empty app.
          try {
            notify(enterProject(await openProjectByPath(host, pending)));
            return;
          } catch {
            // OS-requested project unavailable — fall through to session restore
          }
        }
        const json = await host.loadSession();
        if (!json) return;
        const s = parseSessionJson(json);
        if (!s.projectPath) return;
        const config = parseProjectConfig(
          new TextDecoder().decode(await host.readFile(joinPath(s.projectPath, PROJECT_FILE))),
        );
        const ws = new Workspace(s.projectPath, config);
        const restoredViews: Record<string, ViewState> = {};
        const restoredViewports: Record<string, Viewport> = {};
        const restoredOrbits: Record<string, Orbit> = {};
        let unresolvedCount = 0;
        let missingImages = 0;
        for (const ts of s.tabs) {
          if (ts.kind === "image") {
            // path-only persistence: re-read the file; a missing image just drops the tab
            try {
              const bytes = await host.readFile(ts.path);
              ws.openTab({ kind: "image", id: ts.id, path: ts.path, bytes, mimeType: imageMime(ts.path), pinned: ts.pinned });
            } catch {
              missingImages += 1;
            }
            continue;
          }
          // Resolve the diffuse, but a transient failure (remote host down, file:// on an unmounted
          // drive) must NOT drop the tab — that silently lost a dirty, never-saved doc's work forever
          // once the continuous stash overwrote the session with only survivors. Keep the tab with a
          // blank placeholder + unresolved flag; the doc stays intact and stashable, and Reload Diffuse
          // relinks the real source.
          // A CLEAN tab reloads from disk — the .lmb may have changed since the session was stashed (git
          // pull, another editor). The snapshot is only a fallback for a missing/corrupt file. A DIRTY
          // tab always keeps its snapshot: it has unsaved work the disk copy doesn't, and reloading would
          // silently discard it.
          let doc = ts.doc;
          if (!ts.dirty && ts.docPath && (await host.pathExists(ts.docPath))) {
            try {
              const reloaded = parseDoc(new TextDecoder().decode(await host.readFile(ts.docPath)));
              doc = reloaded;
            } catch {
              doc = ts.doc; // unreadable/corrupt on disk -> fall back to the snapshot
            }
          }
          let bytes: Uint8Array;
          let unresolved = false;
          try {
            bytes = await resolveDiffuse(host, doc.source.uri, { baseDir: s.projectPath }); // relative, file:// or cached http(s)
          } catch {
            // Blank placeholder SIZED TO THE DOC — setDiffuse enforces exact dims, so a 1x1 would throw
            // and (no error boundary) unmount the app to a blank screen. A doc-sized transparent image
            // uploads fine; the height field still renders and the user relinks via Reload Diffuse.
            bytes = encode({
              width: doc.source.width,
              height: doc.source.height,
              data: new Uint8Array(doc.source.width * doc.source.height * 4),
            });
            unresolved = true;
            unresolvedCount += 1;
          }
          const store = new DocumentStore(doc, ts.docPath);
          if (ts.dirty) store.reset(doc, ts.docPath, { dirty: true });
          if (ts.selectedId && findNode(doc.layers, ts.selectedId)) store.select(ts.selectedId);
          const tab: Tab = { kind: "doc", id: ts.id, docPath: ts.docPath, store, diffuse: { bytes, unresolved }, pinned: ts.pinned };
          ws.openTab(tab);
          // backfill fields added since the session was saved; migrate the retired editor "lit" mode to normal
          restoredViews[ts.id] = { ...DEFAULT_VIEW, ...ts.view, mode: ts.view.mode === "lit" ? "normal" : ts.view.mode };
          if (ts.viewport) restoredViewports[ts.id] = ts.viewport;
          if (ts.orbit) restoredOrbits[ts.id] = ts.orbit;
        }
        if (ws.tabs.length > 0) ws.activeIndex = Math.min(Math.max(0, s.activeIndex), ws.tabs.length - 1);
        setWorkspace(ws);
        refreshSidecar(s.projectPath); // restored projects keep their remote-ness (sync/export verbs, root name)
        setViews(restoredViews);
        setViewports(restoredViewports);
        setOrbits(restoredOrbits);
        recordRecent(s.projectPath);
        const warnings: string[] = [];
        if (s.droppedTabs > 0) {
          warnings.push(`${s.droppedTabs} unreadable tab${s.droppedTabs === 1 ? "" : "s"} skipped`);
        }
        if (unresolvedCount > 0) {
          warnings.push(
            `${unresolvedCount} document${unresolvedCount === 1 ? "" : "s"} without ${unresolvedCount === 1 ? "its" : "their"} diffuse (use Reload Diffuse)`,
          );
        }
        if (missingImages > 0) {
          warnings.push(`${missingImages} image tab${missingImages === 1 ? "" : "s"} skipped (file missing)`);
        }
        if (warnings.length > 0) notify(`Restored ${s.projectPath} — ${warnings.join("; ")}`, "error");
        else notify(`Restored ${s.projectPath}`);
      } catch {
        // no session, corrupt session, or moved files: start with no project
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // continuous stash (crash recovery): debounce a second after any workspace/document change
  const stashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!workspace) return;
    const schedule = (): void => {
      if (stashTimer.current) clearTimeout(stashTimer.current);
      stashTimer.current = setTimeout(() => {
        const stash = buildStash();
        if (stash) void getHost().saveSession(stash);
      }, 1000);
    };
    const unsubW = workspace.subscribe(schedule);
    const unsubS = activeDoc?.store.subscribe(schedule);
    schedule();
    return () => {
      unsubW();
      unsubS?.();
      if (stashTimer.current) clearTimeout(stashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, active, activeDoc, views, viewports, orbits]);

  // ?demo capture bootstrap (fixtures -> in-memory project + readiness flag) — QC-CARRY-2 extraction
  useDemoBootstrap({ setWorkspace, setViews, setSwapped, setNewDocPath, setSelVerts, setTool, setBoxMode, openSettings, runAction: (id) => runMenuActionRef.current(id), defaultView: DEFAULT_VIEW });
  // the window-level editor keymap (tools, Esc, Delete, nudges, copy/paste, X/V) — QC-CARRY-2 extraction
  useEditorKeymap({ workspaceRef, runMenuActionRef, bindingsRef: editorBindingsRef, selVertsRef, nudgeEndTimer, setSwapped, setSelVerts, setTool, setActiveView, onChordPending: setChordPending });
  // Explorer root-row label: remote clones show the server's project name (rename disabled);
  // local projects the configured name, else the directory basename.
  const projectDisplayName = sidecar?.projectPath ?? workspace?.config.name ?? (workspace ? basename(workspace.projectPath) : "");

  const tabInfos = workspace
    ? workspace.tabs.map((t) => {
        const p = tabPath(t);
        return {
          id: t.id,
          name: p ? basename(p) : "untitled",
          dirty: t.kind === "doc" && t.store.state.dirty,
          pinned: t.pinned,
          docPath: p,
        };
      })
    : [];

  // tab context-menu extensions: path + reveal verbs (only for saved docs — untitled has no path)
  const tabExtraItems = (tab: { id: string }): MenuItem[] => {
    const ws = workspaceRef.current;
    const target = ws?.tabs[ws.indexById(tab.id)];
    const docPath = target ? tabPath(target) : null;
    if (!ws || !docPath) return [];
    const relative = docPath.startsWith(ws.projectPath) ? docPath.slice(ws.projectPath.length).replace(/^\//, "") : docPath;
    return [
      { label: "Copy Path", run: () => void navigator.clipboard.writeText(docPath) },
      { label: "Copy Relative Path", run: () => void navigator.clipboard.writeText(relative) },
      { label: "Open Containing Folder", run: () => void getHost().revealPath(docPath) },
      { label: "Reveal in Explorer View", run: () => explorerActions.current?.reveal(docPath) },
    ];
  };

  const hasSel = !!state && state.selectedIds.length > 0;
  const canAlign = !!state && state.selectedIds.length >= 2;
  const canDistribute = !!state && state.selectedIds.length >= 3;
  const menuModel: MenuModel = buildMenuModel({
    action: runMenuAction,
    about: () => setShowAbout(true),
    keys: (id) => bindings.get(id) ?? undefined,
    hasWorkspace: !!workspace,
    hasActive: !!active,
    hasDoc: !!activeDoc,
    hasSel,
    hasRemote: sidecar !== null,
    canAlign,
    canDistribute,
    canUndo: !!activeDoc?.store.canUndo,
    canRedo: !!activeDoc?.store.canRedo,
    hasPresets: (workspace?.config.presets?.length ?? 0) > 0,
    rulers,
    pixelGrid,
  });

  return (
    <KeybindingProvider config={keybindingsConfig}>
    <div className="flex h-screen flex-col bg-bg text-base text-fg">
      {/* always rendered: with a frameless window this bar IS the titlebar (drag + window controls) */}
      <Toolbar
        menu={menuModel}
        controls={
          activeDoc && state ? (
            <ViewControls
              store={activeDoc.store}
              state={state}
              view={activeView}
              setView={setActiveView}
              snap={snap}
              setSnap={setSnap}
              normalAlphaGate={normalAlphaGate}
              setNormalAlphaGate={setNormalAlphaGate}
            />
          ) : undefined
        }
      />
      {showAbout ? <AboutDialog onClose={() => setShowAbout(false)} /> : null}
      {resizeAsk ? (
        <ResizeMigrationDialog
          name={resizeAsk.kind === "open" ? basename(resizeAsk.docPath) : "The reloaded diffuse"}
          oldW={resizeAsk.kind === "open" ? resizeAsk.doc.source.width : resizeAsk.oldW}
          oldH={resizeAsk.kind === "open" ? resizeAsk.doc.source.height : resizeAsk.oldH}
          newW={resizeAsk.width}
          newH={resizeAsk.height}
          onPick={applyResizeMigration}
          onClose={() => setResizeAsk(null)}
        />
      ) : null}
      <CommandProvider registry={registry}>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </CommandProvider>
      {remoteCloneOpen ? (
        <RemoteCloneDialog
          servers={remoteServers}
          onAddServer={() => {
            setRemoteCloneOpen(false);
            openSettingsDialog("prefs", "app-remotes");
          }}
          onCloned={(dir) => {
            setRemoteCloneOpen(false);
            openPath(dir);
          }}
          onClose={() => setRemoteCloneOpen(false)}
        />
      ) : null}
      {/* prefs are app-level (shortcuts, updates, remote servers) — no workspace required, and the
          clone-from-launch-screen flow needs Remote Servers reachable before any project exists */}
      {settingsOpen === "prefs" ? (
        <PreferencesDialog
          bindingOverrides={bindingOverrides}
          onBindingOverrides={setBindingOverrides}
          autoUpdateCheck={autoUpdateCheck}
          onAutoUpdateCheck={setAutoUpdateCheck}
          remoteServers={remoteServers}
          onRemoteServers={setRemoteServers}
          initialScreen={prefsScreen}
          onScreenChange={setPrefsScreen}
          onClose={() => setSettingsOpen(null)}
        />
      ) : null}
      {settingsOpen === "project" && workspace ? (
        <ProjectSettingsDialog
          config={workspace.config}
          onConfig={persistConfig}
          initialScreen={projectScreen}
          onScreenChange={setProjectScreen}
          onClose={() => setSettingsOpen(null)}
        />
      ) : null}
      {settingsOpen === "doc" && workspace && activeDoc && state ? (
        <DocumentSettingsDialog
          config={workspace.config}
          store={activeDoc.store}
          state={state}
          initialScreen={docScreen}
          onScreenChange={setDocScreen}
          onClose={() => setSettingsOpen(null)}
        />
      ) : null}
      {newDocPath !== null ? (
        <NewDocumentDialog
          onConfirm={(uri) => {
            const path = newDocPath;
            setNewDocPath(null);
            createDocAt(path, uri);
          }}
          onClose={() => setNewDocPath(null)}
        />
      ) : null}
      <div className="flex min-h-0 flex-1">
        {workspace ? (
          <>
            <aside className="flex shrink-0 flex-col bg-bg" style={{ width: leftWidth }}>
              {activeDoc ? (
                <div className="p-3 pb-0">
                  <Library enabled onPick={pickObject} savedPresets={workspace?.config.presets ?? []} onDeletePreset={deletePreset} />
                </div>
              ) : null}
              {/* Layers + Explorer as two real sections with a draggable split (vscode/godot style);
                  the Layers pane holds the persisted fixed height, the Explorer flexes. */}
              <div className="min-h-0 flex-1 pt-3">
                <SplitView orientation="vertical" size={layersHeight} onResize={(h) => setLayersHeight(clampSection(h))} min={96}>
                  <div className="flex h-full min-h-0 flex-col px-3">
                    {activeDoc && state ? <Layers store={activeDoc.store} state={state} /> : null}
                  </div>
                  <div className="flex h-full min-h-0 flex-col px-3 pt-2 pb-3">
                    <SectionLabel>Explorer</SectionLabel>
                    {/* bump just the file tree to 13px (JetBrains-ish) by scoping carapace's
                        --text-sm token to this subtree; leaves every other text-sm + carapace untouched */}
                    <div className="-mx-1 min-h-0 flex-1 overflow-y-auto" style={{ ["--text-sm" as string]: "0.8125rem" }}>
                      <FileExplorer
                        root={workspace.projectPath}
                        // .lmb rows carry the Lambert mark itself; everything else (and folders)
                        // resolves through the default Seti set
                        getIcon={(e) =>
                          !e.isDir && /\.lmb$/i.test(e.name)
                            ? <LambertMark className="h-[1.05em] w-[1.05em] shrink-0" />
                            : <FileTypeIcon name={e.name} isDir={e.isDir} />
                        }
                        rootNode={{
                          label: projectDisplayName,
                          // remote clones take the server's project name — renaming is skyrat's
                          // business (project.lambert syncs, so a local rename would push to everyone)
                          onRename: sidecar ? undefined : renameProject,
                        }}
                        onOpen={(p) => {
                          if (/\.lmb$/i.test(p)) openDoc(p);
                          else if (IMAGE_RE.test(p)) openImageTab(p);
                        }}
                        newFile={{ extension: ".lmb", label: "Document" }}
                        onNewFile={beginNewDoc}
                        onDidRename={reconcileRename}
                        onDidDelete={reconcileDelete}
                        actionsRef={explorerActions}
                        getDecoration={(e) => gitDecorations.get(e.path)}
                        // .lmb documents, viewable images, folders. project.lambert is hidden (infra) so it
                        // can't be renamed/deleted from the tree, which would break the project.
                        exclude={(e) =>
                          e.isDir ? IGNORED_DIRS.has(e.name) : e.name === PROJECT_FILE || !(/\.lmb$/i.test(e.name) || IMAGE_RE.test(e.name))
                        }
                        ariaLabel="Project files"
                        storageKey="lambert.explorer.expanded"
                      />
                    </div>
                  </div>
                </SplitView>
              </div>
            </aside>
            {activeDoc ? <ToolPalette tool={tool} setTool={setTool} keyFor={(t) => bindings.get(`tool-${t}`)} /> : null}
            <Sash orientation="vertical" onDrag={(dx) => setLeftWidth((w) => clampPanel(w + dx))} />
          </>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {tabInfos.length > 0 ? (
            <EditorTabs
              tabs={tabInfos.map((t) => ({ id: t.id, title: t.name, dirty: t.dirty, pinned: t.pinned }))}
              activeId={tabInfos[workspace?.activeIndex ?? -1]?.id ?? null}
              onSelect={(id) => workspaceRef.current?.focus(id)}
              onClose={closeDoc}
              onCloseMany={(ids) => void closeMany(ids)}
              onPin={setTabPinned}
              extraMenuItems={tabExtraItems}
              menuShortcut={(v) => bindings.get(v === "close" ? "close-tab" : v === "pin" ? "pin-tab" : v) ?? undefined}
              onReorder={(id, toIndex) => workspaceRef.current?.moveTab(id, toIndex)}
            />
          ) : null}
          {activeDoc && state ? (
            <div
              className="grid min-h-0 flex-1"
              style={{
                gridTemplateColumns: `minmax(0, 1fr) auto ${rightWidth}px`,
                gridTemplateRows: `minmax(0, 1fr) auto ${cornerHeight}px`,
                gridTemplateAreas: '"big sash inspector" "big sash rsash" "big sash corner"',
              }}
            >
              <main className="relative min-w-0 overflow-hidden bg-[var(--color-viewport-bg)]" style={{ gridArea: "big" }}>
                <CanvasView
                  store={activeDoc.store}
                  state={state}
                  view={activeView}
                  tool={tool}
                  diffuseBytes={activeDoc.diffuse.bytes}
                  resolvePaletteObject={resolvePaletteObject}
                  selVerts={selVerts}
                  setSelVerts={setSelVerts}
                  maskFocus={maskFocus}
                  onLightChange={(d) => setActiveView((v) => ({ ...v, lightDir: d }))}
                  onEnergyChange={(en) => setActiveView((v) => ({ ...v, lightEnergy: en }))}
                  canvas3dRef={canvas3dRef}
                  orbit3d={preview3dOn ? cam3d.orbit : null}
                  boxMode={boxMode}
                  boxLitViewport={boxLitViewport}
                  normalDirs={effectiveNormalDirs(state.doc, workspace!.config)}
                  adjustmentDefaults={workspace!.config.adjustmentDefaults}
                  deleteKeys={bindings.get("delete") ?? null}
                  overridesNormalDirs={state.doc.normalDirs !== undefined}
                  openSettings={openSettings}
                  swapped={swapped}
                  tabId={activeDoc.id}
                  savedViewport={viewports[activeDoc.id]}
                  onViewportChange={(vp) => setViewports((m) => ({ ...m, [activeDoc.id]: vp }))}
                  setTool={setTool}
                  snap={snap}
                  rulers={rulers}
                  pixelGrid={pixelGrid}
                  normalAlphaGate={normalAlphaGate}
                />
              </main>
              <div className="flex" style={{ gridArea: "sash" }}>
                <Sash orientation="vertical" onDrag={(dx) => setRightWidth((w) => clampPanel(w - dx))} />
              </div>
              <aside className="overflow-y-auto bg-bg p-3" style={{ gridArea: "inspector" }}>
                <Inspector
                  store={activeDoc.store}
                  state={state}
                  selVerts={selVerts}
                  openSettings={openSettings}
                  setTool={setTool}
                  snap={snap}
                  adjustmentDefaults={workspace!.config.adjustmentDefaults}
                  onSelectMask={(nodeId, maskId) => {
                    activeDoc.store.select(nodeId);
                    setMaskFocus((f) => ({ nodeId, maskId, seq: (f?.seq ?? 0) + 1 }));
                  }}
                />
              </aside>
              <div style={{ gridArea: "rsash" }}>
                <Sash orientation="horizontal" onDrag={(dy) => setCornerHeight((h) => clampCorner(h - dy))} />
              </div>
              <div className="border-t border-border bg-[var(--color-viewport-bg)]" style={{ gridArea: "corner" }} />
              <div
                className="relative overflow-hidden border-t border-border bg-[var(--color-viewport-bg)]"
                style={{ gridArea: swapped ? "big" : "corner" }}
              >
                <Preview3D
                  cam={cam3d}
                  canvasRef={canvas3dRef}
                  docW={state.doc.source.width}
                  docH={state.doc.source.height}
                  enabled={preview3dOn}
                  onToggle={() => setPreview3dOn((v) => !v)}
                  onResize={bumpRender}
                  big={swapped}
                  onSwap={() => setSwapped((s) => !s)}
                  mode={boxMode}
                  onModeChange={setBoxMode}
                  onLitViewport={setBoxLitViewport}
                  lightDir={activeView.lightDir}
                  onLightChange={(d) => setActiveView((v) => ({ ...v, lightDir: d }))}
                  pointLights={activeView.pointLights}
                  onPointLightsChange={(pls) => setActiveView((v) => ({ ...v, pointLights: pls }))}
                />
              </div>
            </div>
          ) : activeImage ? (
            <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--color-viewport-bg)]">
              <ImageView
                key={activeImage.id}
                bytes={activeImage.bytes}
                mimeType={activeImage.mimeType}
                alt={basename(activeImage.path)}
                onInfo={setImageInfo}
              />
            </main>
          ) : workspace ? (
            <div className="flex min-h-0 flex-1 bg-[var(--color-viewport-bg)]">
              <EmptyState
                status="info"
                icon={<LambertMark className="!h-[108px] !w-[108px]" />}
                message="Open a .lmb document from the Explorer, or create a New Document."
                action={
                  <Button variant="primary" onClick={newDocument}>
                    New Document
                  </Button>
                }
              />
            </div>
          ) : (
            <LaunchScreen
              recents={recents}
              onOpenRecent={openRecent}
              onRemoveRecent={removeRecentProject}
              onNew={() => openProject("new")}
              onOpen={() => openProject("open")}
              onRemote={() => setRemoteCloneOpen(true)}
            />
          )}
        </div>
      </div>
      <StatusBar
        left={
          <span className="flex min-w-0 items-center gap-3">
            {workspace ? (
              <span className="max-w-[40vw] truncate text-fg-mid" title={workspace.projectPath}>
                {workspace.projectPath}
              </span>
            ) : null}
            {chordPending ? (
              <span className="min-w-0 truncate text-fg-mid">({formatKeys(chordPending)}) waiting for the second key…</span>
            ) : status ? (
              <span className={`min-w-0 truncate ${status.tone === "error" ? "text-error" : "text-fg-mid"}`} title={status.text}>{status.text}</span>
            ) : null}
          </span>
        }
        right={
          state
            ? `${state.doc.source.width}×${state.doc.source.height} · ${flattenLayers(state.doc.layers).length} objects`
            : activeImage && imageInfo
              ? <span className="whitespace-nowrap">{`${imageInfo.width}×${imageInfo.height} · ${Math.round(imageInfo.zoom * 100)}%`}</span>
              : null
        }
      />
      <UpdateNotice autoCheck={autoUpdateCheck} />
    </div>
    </KeybindingProvider>
  );
}
