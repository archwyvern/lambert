import "./styles.css";
import { useEffect, useReducer, useRef, useState } from "react";
import { DocumentStore } from "../document/store";
import { addShape, duplicateShape, removeShape, removeShapeVertices, updateShape } from "../document/docOps";
import { findNode, ungroup, wrapInGroup } from "../document/layerOps";
import { flattenLayers } from "../field/flatten";
import { isGroup, isShape } from "../field/types";
import { emptyDoc, NormalDirs, parseProjectConfig, serializeProjectConfig } from "../document/schema";
import { exportTabNx, hasSidecar, newProjectFlow, openImageTab, openProjectFlow, saveTab } from "../document/io";
import { basename, dirname, joinPath } from "../document/paths";
import { buildSessionJson, parseSessionJson } from "../document/session";
import { PROJECT_FILE, Tab, Workspace } from "../document/workspace";
import { CanvasView } from "./CanvasView";
import type { Viewport } from "./viewport";
import { DEFAULT_ORBIT, type Orbit } from "../field/gpu/preview3d";
import { Preview3D } from "./Preview3D";
import { use3DCamera } from "./use3DCamera";
import { ToolPalette } from "./ToolPalette";
import { getHost } from "./host";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { Library } from "./Library";
import { Button, SectionLabel } from "./kit";
import { UpdateNotice } from "./UpdateNotice";
import { FileExplorer } from "@carapace/shell";
import type { DirEntry, FileExplorerProps, MenuModel } from "@carapace/shell";
import { DocumentRegular, FolderRegular, ImageRegular } from "@fluentui/react-icons";
import { usePersistentState } from "./persist";
import { Sash, EditorTabs, StatusBar, useConfirm, useToast, EmptyState } from "@carapace/shell";
import { Toolbar } from "./Toolbar";
import { LambertMark } from "./LambertMark";
import type { ViewMode } from "./preview";
import { VIEW_MODES } from "./preview";
import { TOOL_KEYS, ToolMode } from "./tools";
import { v2 } from "../field/vec";

const clampPanel = (w: number): number => Math.min(480, Math.max(160, w));
const clampCorner = (h: number): number => Math.min(800, Math.max(120, h));

// dirs the explorer never descends into (matches drydock's tree pruning)
const IGNORED_DIRS = new Set(["node_modules", ".git", "bin", "obj", ".godot"]);

/** Leading glyph for a file-tree entry: folder / image / generic file. */
const fileIcon = (e: DirEntry): React.ReactNode => {
  const props = { className: "shrink-0 text-fg-mid", style: { fontSize: 14 } };
  if (e.isDir) return <FolderRegular {...props} />;
  if (/\.png$/i.test(e.name)) return <ImageRegular {...props} />;
  return <DocumentRegular {...props} />;
};

export interface ViewState {
  mode: ViewMode;
  /** Overlay opacity for the normal view (1 = 100%). */
  opacity: number;
  lightDir: [number, number, number];
  /** Lit view: light intensity multiplier (1 = default). */
  lightEnergy: number;
  /** Raster view: the pixelated exported output instead of the crisp display-res vector view. */
  raster: boolean;
  /** Lit view: preview the full Skyrat pipeline (alpha-volume + NX override + radial + gradient). */
  fullPipeline: boolean;
}

const DEFAULT_VIEW: ViewState = { mode: "lit", opacity: 1, lightDir: [-0.5, -0.5, 0.7], lightEnergy: 1, raster: false, fullPipeline: false };

export function App(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [views, setViews] = useState<Record<string, ViewState>>({});
  const [viewports, setViewports] = useState<Record<string, Viewport>>({}); // per-image 2D pan/zoom
  const [orbits, setOrbits] = useState<Record<string, Orbit>>({}); // per-image 3D camera
  const [tool, setTool] = useState<ToolMode>("select");
  const [selVerts, setSelVerts] = useState<number[]>([]);
  const selVertsRef = useRef(selVerts);
  selVertsRef.current = selVerts;
  const nudgeEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // commits a nudge burst's undo group
  const [snap, setSnap] = usePersistentState("snap", true); // global ½px grid snap for all edits
  const [rulers, setRulers] = usePersistentState("rulers", true); // top/left canvas rulers (View > Rulers)
  const [leftWidth, setLeftWidth] = usePersistentState("panel:left", 220);
  const [rightWidth, setRightWidth] = usePersistentState("panel:right", 288);
  const toast = useToast();
  const confirm = useConfirm();
  const cam3d = use3DCamera();
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const [swapped, setSwapped] = usePersistentState("panel:3d:swapped", false);
  const [cornerHeight, setCornerHeight] = usePersistentState("panel:3d:corner", 300);
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const active = workspace?.active ?? null;
  const state = active?.store.state ?? null;

  const notify = (msg: string, tone: "info" | "error" = "info"): void => toast.notify(msg, { tone });
  const run = (p: Promise<unknown>): void =>
    void p
      .then((msg) => {
        if (typeof msg === "string") notify(msg);
      })
      .catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), "error"));

  // re-render whenever the workspace structure or the active document changes
  useEffect(() => (workspace ? workspace.subscribe(forceUpdate) : undefined), [workspace]);
  useEffect(() => (active ? active.store.subscribe(forceUpdate) : undefined), [active]);
  useEffect(() => setSelVerts([]), [state?.selectedId]);
  useEffect(() => setSelVerts([]), [active?.imagePath]); // drop stale vertex indices when switching tabs

  // 3D camera persistence: re-seed the orbit from the per-image saved camera when the active image
  // changes (default framing on first open), and report camera moves back so each image keeps its own
  // angle — survives tab switch + reload, instead of one global camera shared across all images.
  useEffect(() => {
    if (active) cam3d.setOrbit(orbitsRef.current[active.imagePath] ?? { ...DEFAULT_ORBIT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.imagePath]);
  useEffect(() => {
    if (active) setOrbits((m) => (m[active.imagePath] === cam3d.orbit ? m : { ...m, [active.imagePath]: cam3d.orbit }));
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

  const activeView = (active && views[active.imagePath]) || DEFAULT_VIEW;
  const setActiveView = (fn: (v: ViewState) => ViewState): void => {
    const t = workspaceRef.current?.active;
    if (!t) return;
    setViews((vs) => ({ ...vs, [t.imagePath]: fn(vs[t.imagePath] ?? DEFAULT_VIEW) }));
  };

  const openProject = (which: "open" | "new"): void =>
    run(
      (async () => {
        const opened = await (which === "new" ? newProjectFlow : openProjectFlow)(getHost());
        if (!opened) return;
        setWorkspace(new Workspace(opened.projectPath, opened.config));
        setViews({});
        return `Opened ${opened.projectPath}`;
      })(),
    );

  const openImage = (imagePath: string): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    if (ws.indexOf(imagePath) >= 0) {
      ws.focus(imagePath);
      return;
    }
    run(
      (async () => {
        const tab = await openImageTab(getHost(), imagePath);
        // a new tab inherits the current tab's view (mode/opacity/light) rather than snapping to the
        // lit/100% default — so flipping between images keeps the working view.
        const prevView = (ws.active && viewsRef.current[ws.active.imagePath]) || DEFAULT_VIEW;
        setViews((vs) => (vs[imagePath] ? vs : { ...vs, [imagePath]: { ...prevView } }));
        ws.openTab(tab);
      })(),
    );
  };

  const closeImage = async (imagePath: string): Promise<void> => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const t = ws.tabs[ws.indexOf(imagePath)];
    if (t?.store.state.dirty) {
      const r = await confirm({
        title: `${basename(imagePath)} has unsaved changes`,
        message: "Close anyway? Your unsaved changes will be lost.",
        confirmLabel: "Close",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (r !== "confirm") return;
    }
    ws.closeTab(imagePath);
  };

  const saveActive = (): void => {
    const ws = workspaceRef.current;
    const t = ws?.active;
    if (!ws || !t) return;
    run(saveTab(getHost(), t).then((p) => `Saved ${p}`));
  };

  const saveAll = (): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    run(
      (async () => {
        const dirty = ws.tabs.filter((t) => t.store.state.dirty);
        for (const t of dirty) await saveTab(getHost(), t);
        return `Saved ${dirty.length} file${dirty.length === 1 ? "" : "s"}`;
      })(),
    );
  };

  const exportActive = (): void => {
    const ws = workspaceRef.current;
    const t = ws?.active;
    if (ws && t) run(exportTabNx(getHost(), t, ws.config));
  };

  const setNormalDirs = (dirs: NormalDirs): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const config = { ...ws.config, normalDirs: dirs };
    ws.setConfig(config);
    void getHost().writeFile(
      joinPath(ws.projectPath, PROJECT_FILE),
      new TextEncoder().encode(serializeProjectConfig(config)),
    );
  };

  // add a shape from the library popover, at the document origin
  const pickShape = (typeId: string): void => {
    const t = workspaceRef.current?.active;
    if (!t) return;
    const o = t.store.state.doc.canvas.origin;
    t.store.update((d) => addShape(d, typeId, v2(o.x, o.y)));
    const layers = t.store.state.doc.layers;
    t.store.select(layers[layers.length - 1]?.id ?? null);
    t.store.endGesture();
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
      tabs: ws.tabs.map((t) => ({
        imagePath: t.imagePath,
        docPath: t.docPath,
        dirty: t.store.state.dirty,
        doc: t.store.state.doc,
        view: vs[t.imagePath] ?? DEFAULT_VIEW,
        selectedId: t.store.state.selectedId,
        viewport: vpts[t.imagePath],
        orbit: obs[t.imagePath],
      })),
    });
  };

  // application-menu actions — shared by the OS-menu accelerators (via onMenuAction) and the
  // in-window MenuBar (the menuModel built below). Defined in render so it sees fresh state; the
  // IPC listener calls the latest via a ref so it registers only once.
  const runMenuAction = (action: string): void => {
    const t = workspaceRef.current?.active;
    const ids = t?.store.state.selectedIds ?? [];
    switch (action) {
      case "new-project":
        return openProject("new");
      case "open-project":
        return openProject("open");
      case "save":
        return saveActive();
      case "save-all":
        return saveAll();
      case "export-nx":
        return exportActive();
      case "undo":
        return t?.store.undo();
      case "redo":
        return t?.store.redo();
      case "duplicate":
        if (t && ids.length) {
          t.store.update((d) => ids.reduce((acc, sid) => duplicateShape(acc, sid), d));
          t.store.endGesture();
        }
        return;
      case "delete":
        if (t && ids.length) {
          t.store.update((d) => ids.reduce((acc, sid) => removeShape(acc, sid), d));
          t.store.endGesture();
        }
        return;
      case "group":
        if (t && ids.length) {
          const gid = crypto.randomUUID();
          t.store.update((d) => ({ ...d, layers: wrapInGroup(d.layers, ids, gid, d.canvas.origin) }));
          t.store.endGesture();
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
      case "zoom-fit":
      case "zoom-100":
        window.dispatchEvent(new CustomEvent("lambert-zoom", { detail: action }));
        return;
      case "toggle-rulers":
        return setRulers((r) => !r);
    }
  };
  const runMenuActionRef = useRef(runMenuAction);
  runMenuActionRef.current = runMenuAction;
  useEffect(() => {
    getHost().onMenuAction((a) => runMenuActionRef.current(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close guard: confirm when any tab is dirty, and flush the session stash before closing
  useEffect(() => {
    const host = getHost();
    host.guardClose();
    host.onConfirmClose(async () => {
      const ws = workspaceRef.current;
      const anyDirty = ws?.tabs.some((t) => t.store.state.dirty) ?? false;
      let ok = true;
      if (anyDirty) {
        const r = await confirm({
          title: "Unsaved changes",
          message: "Close anyway? Your unsaved changes will be lost.",
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

  // session restore: reopen the last project and its tabs
  useEffect(() => {
    if (new URLSearchParams(location.search).has("demo")) return;
    void (async () => {
      try {
        const host = getHost();
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
        for (const ts of s.tabs) {
          const bytes = await host.readFile(ts.imagePath);
          const store = new DocumentStore(ts.doc, ts.docPath);
          if (ts.dirty) store.reset(ts.doc, ts.docPath, { dirty: true });
          if (ts.selectedId && findNode(ts.doc.layers, ts.selectedId)) store.select(ts.selectedId);
          const tab: Tab = { imagePath: ts.imagePath, docPath: ts.docPath, store, diffuse: { bytes, dir: dirname(ts.imagePath) } };
          ws.openTab(tab);
          restoredViews[ts.imagePath] = { ...DEFAULT_VIEW, ...ts.view }; // backfill fields added since the session was saved
          if (ts.viewport) restoredViewports[ts.imagePath] = ts.viewport;
          if (ts.orbit) restoredOrbits[ts.imagePath] = ts.orbit;
        }
        if (ws.tabs.length > 0) ws.activeIndex = Math.min(Math.max(0, s.activeIndex), ws.tabs.length - 1);
        setWorkspace(ws);
        setViews(restoredViews);
        setViewports(restoredViewports);
        setOrbits(restoredOrbits);
        notify(`Restored ${s.projectPath}`);
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
    const unsubS = active?.store.subscribe(schedule);
    schedule();
    return () => {
      unsubW();
      unsubS?.();
      if (stashTimer.current) clearTimeout(stashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, active, views, viewports, orbits]);

  // demo bootstrap for automated captures: a one-tab in-memory project
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has("demo")) return;
    void Promise.all([import("fast-png"), import("../field/fixtures")])
      .then(([{ encode }, { goldenShapes, maskedShapes, meshShapes }]) => {
        const w = 96;
        const h = 96;
        const data = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          data[i * 4] = 96;
          data[i * 4 + 1] = 104;
          data[i * 4 + 2] = 118;
          data[i * 4 + 3] = 255;
        }
        const shapes = q.has("masked") ? maskedShapes() : q.has("mesh") ? meshShapes() : goldenShapes();
        const doc = { ...emptyDoc("demo.png", w, h), layers: shapes };
        const ws = new Workspace("/demo", { schemaVersion: 1, normalDirs: { red: "right", green: "up" } });
        const tab: Tab = {
          imagePath: "/demo/demo.png",
          docPath: null,
          store: new DocumentStore(doc, null),
          diffuse: { bytes: encode({ width: w, height: h, data }), dir: "/demo" },
        };
        ws.openTab(tab);
        const mode = q.get("mode");
        const v: ViewState = { ...DEFAULT_VIEW };
        if (mode && (VIEW_MODES as string[]).includes(mode)) v.mode = mode as ViewMode;
        if (q.has("raster")) v.raster = true;
        if (q.has("swap")) setSwapped(true);
        setWorkspace(ws);
        setViews({ "/demo/demo.png": v });
        const select = q.get("select");
        if (select) tab.store.select(findNode(doc.layers, select)?.id ?? doc.layers[0]?.id ?? null);
        const t = q.get("tool");
        if (t && t in TOOL_KEYS) setTool(TOOL_KEYS[t]!);
        const markReady = (): void => {
          (window as unknown as { __lambertDemoReady?: boolean }).__lambertDemoReady = true;
        };
        if (q.has("cmenu")) {
          const onEdge = q.get("cmenu") === "edge";
          setTimeout(() => {
            if (!onEdge) setSelVerts([0, 2]);
            setTimeout(() => {
              const sel = onEdge ? "svg line.cursor-context-menu" : "svg circle.cursor-move";
              const c = document.querySelector<SVGElement>(sel);
              if (c) {
                const r = c.getBoundingClientRect();
                c.dispatchEvent(
                  new MouseEvent("contextmenu", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }),
                );
              }
              markReady();
            }, 150);
          }, 150);
        } else {
          markReady();
        }
      })
      .catch((err: unknown) => console.error("demo bootstrap failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // editor keys (file/undo accelerators are owned by the application menu)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      // Ctrl/Cmd+Shift+Z = redo (Photoshop-style), in addition to the menu's Ctrl+Y. Handled here, not
      // in the menu, because a MenuItem takes a single accelerator; this combo isn't a menu accelerator
      // so there's no double-fire with the menu-owned Ctrl+Z/Ctrl+Y.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        workspaceRef.current?.active?.store.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSwapped((sw) => !sw);
        return;
      }
      const t = workspaceRef.current?.active;
      if (!t) return;
      const store = t.store;
      const id = store.state.selectedId;
      const key = e.key.toLowerCase();
      if (key in TOOL_KEYS) {
        setTool(TOOL_KEYS[key]!);
      } else if (e.key === "Escape") {
        // ESC deselects the whole shape (and any vertex sub-selection); an empty canvas click only
        // clears the vertex/anchor selection and keeps the shape (see CanvasView endDrag + MaskGizmo)
        setSelVerts([]);
        store.select(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && id) {
        const node = findNode(store.state.doc.layers, id);
        const shape = node && isShape(node) ? node : null;
        const verts = selVertsRef.current;
        if (shape?.bezier && verts.length > 0) {
          // delete the selected cable anchor(s) — never below the 2-anchor minimum (don't nuke the cable)
          if (shape.bezier.length - verts.length >= 2) {
            store.update((d) =>
              updateShape(d, id, (s) => ({ ...s, bezier: s.bezier?.filter((_, i) => !verts.includes(i)) })),
            );
            setSelVerts([]);
          }
        } else if (shape && verts.length > 0 && shape.controlPoints.length > 0) {
          // delete selected vertices (mesh / polygon / polyline / ring), guarded per kind
          store.update((d) => updateShape(d, id, (s) => removeShapeVertices(s, verts)));
          setSelVerts([]);
        } else {
          // no vertex sub-selection: delete every selected layer
          const sel = store.state.selectedIds;
          store.update((d) => sel.reduce((acc, sid) => removeShape(acc, sid), d));
        }
        store.endGesture();
      } else if (key === "v") {
        setActiveView((s) => ({ ...s, mode: VIEW_MODES[(VIEW_MODES.indexOf(s.mode) + 1) % VIEW_MODES.length]! }));
      } else if (e.key.startsWith("Arrow") && id) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const node = findNode(store.state.doc.layers, id);
        const shape = node && isShape(node) ? node : null;
        const verts = selVertsRef.current;
        if (shape?.bezier && verts.length > 0) {
          // nudge selected cable anchors (move the point; handles are offsets and follow)
          store.update(
            (d) =>
              updateShape(d, id, (s) => ({
                ...s,
                bezier: s.bezier?.map((a, i) => (verts.includes(i) ? { ...a, p: v2(a.p.x + dx, a.p.y + dy) } : a)),
              })),
            { coalesce: `vnudge:${id}` },
          );
        } else if (shape && verts.length > 0 && shape.controlPoints.length > 0) {
          // nudge selected control-point vertices (polygon / polyline / ring / mesh)
          store.update(
            (d) =>
              updateShape(d, id, (s) => ({
                ...s,
                controlPoints: s.controlPoints.map((p, i) => (verts.includes(i) ? v2(p.x + dx, p.y + dy) : p)),
              })),
            { coalesce: `vnudge:${id}` },
          );
        } else {
          store.update(
            (d) =>
              updateShape(d, id, (s) => ({
                ...s,
                transform: { ...s.transform, pos: s.transform.pos.withX(s.transform.pos.x + dx).withY(s.transform.pos.y + dy) },
              })),
            { coalesce: `nudge:${id}` },
          );
        }
        // a burst of nudges collapses to one undo entry; commit it after a short pause so the next
        // edit (or a later nudge after thinking) is its own undo step.
        if (nudgeEndTimer.current) clearTimeout(nudgeEndTimer.current);
        nudgeEndTimer.current = setTimeout(() => store.endGesture(), 500);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabInfos = workspace
    ? workspace.tabs.map((t) => ({ imagePath: t.imagePath, name: basename(t.imagePath), dirty: t.store.state.dirty }))
    : [];

  const hasSel = !!state && state.selectedIds.length > 0;
  const menuModel: MenuModel = [
    {
      label: "&&File",
      items: [
        { label: "New Project…", shortcut: "Ctrl+Shift+N", run: () => runMenuAction("new-project") },
        { label: "Open Project…", shortcut: "Ctrl+O", run: () => runMenuAction("open-project") },
        { separator: true },
        { label: "Save", shortcut: "Ctrl+S", enabled: !!active, run: () => runMenuAction("save") },
        { label: "Save All", shortcut: "Ctrl+Shift+S", enabled: !!workspace, run: () => runMenuAction("save-all") },
        { separator: true },
        { label: "Export NX", shortcut: "Ctrl+E", enabled: !!active, run: () => runMenuAction("export-nx") },
      ],
    },
    {
      label: "&&Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", enabled: !!active?.store.canUndo, run: () => runMenuAction("undo") },
        { label: "Redo", shortcut: "Ctrl+Y", enabled: !!active?.store.canRedo, run: () => runMenuAction("redo") },
        { separator: true },
        { label: "Duplicate", shortcut: "Ctrl+D", enabled: hasSel, run: () => runMenuAction("duplicate") },
        { label: "Delete", enabled: hasSel, run: () => runMenuAction("delete") },
        { separator: true },
        { label: "Group", shortcut: "Ctrl+G", enabled: hasSel, run: () => runMenuAction("group") },
        { label: "Ungroup", shortcut: "Ctrl+Shift+G", enabled: hasSel, run: () => runMenuAction("ungroup") },
      ],
    },
    {
      label: "&&View",
      items: [
        { label: "Fit", shortcut: "Ctrl+0", enabled: !!active, run: () => runMenuAction("zoom-fit") },
        { label: "100%", shortcut: "Ctrl+1", enabled: !!active, run: () => runMenuAction("zoom-100") },
        { separator: true },
        { label: "Rulers", shortcut: "Ctrl+R", enabled: !!active, run: () => runMenuAction("toggle-rulers") },
      ],
    },
    {
      label: "&&Help",
      items: [{ label: "Check for Updates…", run: () => runMenuAction("check-updates") }],
    },
  ];

  return (
    <div className="flex h-screen flex-col bg-bg text-base text-fg">
      <Toolbar
        menu={menuModel}
        store={active?.store}
        state={active && state ? state : undefined}
        view={activeView}
        setView={setActiveView}
        snap={snap}
        setSnap={setSnap}
      />
      <div className="flex min-h-0 flex-1">
        {workspace ? (
          <>
            <aside className="flex shrink-0 flex-col gap-3 bg-bg p-3" style={{ width: leftWidth }}>
              {active ? <Library enabled onPick={pickShape} /> : null}
              {active && state ? <Layers store={active.store} state={state} /> : null}
              <div className="flex min-h-0 flex-1 flex-col">
                <SectionLabel>Explorer</SectionLabel>
                {/* bump just the file tree to 13px (JetBrains-ish) by scoping carapace's
                    --text-sm token to this subtree; leaves every other text-sm + carapace untouched */}
                <div className="-mx-1 min-h-0 flex-1 overflow-y-auto" style={{ ["--text-sm" as string]: "0.8125rem" }}>
                  {/* getIcon cast bridges a duplicate @types/react (carapace pins 19.0, lambert
                      19.2); the ReactNode shapes are identical, only nominally distinct */}
                  <FileExplorer
                    root={workspace.projectPath}
                    onOpen={(p) => {
                      if (/\.png$/i.test(p) && !/\.nx\.png$/i.test(p)) openImage(p);
                    }}
                    getIcon={fileIcon as FileExplorerProps["getIcon"]}
                    exclude={(e) => (e.isDir ? IGNORED_DIRS.has(e.name) : /\.(lnb|flatland)$/i.test(e.name))}
                    ariaLabel="Project files"
                    storageKey="lambert.explorer.expanded"
                  />
                </div>
              </div>
            </aside>
            {active ? <ToolPalette tool={tool} setTool={setTool} /> : null}
            <Sash orientation="vertical" onDrag={(dx) => setLeftWidth((w) => clampPanel(w + dx))} />
          </>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {tabInfos.length > 0 ? (
            <EditorTabs
              tabs={tabInfos.map((t) => ({ id: t.imagePath, title: t.name, dirty: t.dirty }))}
              activeId={tabInfos[workspace?.activeIndex ?? -1]?.imagePath ?? null}
              onSelect={(id) => workspaceRef.current?.focus(id)}
              onClose={closeImage}
            />
          ) : null}
          {active && state ? (
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
                  store={active.store}
                  state={state}
                  view={activeView}
                  tool={tool}
                  diffuseBytes={active.diffuse.bytes}
                  selVerts={selVerts}
                  setSelVerts={setSelVerts}
                  onLightChange={(d) => setActiveView((v) => ({ ...v, lightDir: d }))}
                  onEnergyChange={(en) => setActiveView((v) => ({ ...v, lightEnergy: en }))}
                  canvas3dRef={canvas3dRef}
                  orbit3d={cam3d.orbit}
                  normalDirs={workspace!.config.normalDirs}
                  swapped={swapped}
                  imagePath={active.imagePath}
                  savedViewport={viewports[active.imagePath]}
                  onViewportChange={(vp) => setViewports((m) => ({ ...m, [active.imagePath]: vp }))}
                  setTool={setTool}
                  snap={snap}
                  rulers={rulers}
                />
              </main>
              <div className="flex" style={{ gridArea: "sash" }}>
                <Sash orientation="vertical" onDrag={(dx) => setRightWidth((w) => clampPanel(w - dx))} />
              </div>
              <aside className="overflow-y-auto bg-bg p-3" style={{ gridArea: "inspector" }}>
                <Inspector
                  store={active.store}
                  state={state}
                  selVerts={selVerts}
                  normalDirs={workspace!.config.normalDirs}
                  onNormalDirs={setNormalDirs}
                  setTool={setTool}
                  snap={snap}
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
                  enabled={true}
                  onResize={bumpRender}
                  big={swapped}
                  onSwap={() => setSwapped((s) => !s)}
                  lightDir={activeView.lightDir}
                  onLightChange={(d) => setActiveView((v) => ({ ...v, lightDir: d }))}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 bg-[var(--color-viewport-bg)]">
              <EmptyState
                status="info"
                icon={<LambertMark className="!h-[108px] !w-[108px]" />}
                message={
                  workspace
                    ? "Open an image from the Explorer to start placing shapes."
                    : "Create a new project or open an existing one to start authoring height fields."
                }
                action={
                  workspace ? undefined : (
                    <div className="flex gap-2">
                      <Button variant="primary" onClick={() => openProject("new")}>
                        New Project
                      </Button>
                      <Button variant="ghost" onClick={() => openProject("open")}>
                        Open Project
                      </Button>
                    </div>
                  )
                }
              />
            </div>
          )}
        </div>
      </div>
      <StatusBar
        left={null}
        right={state ? `${state.doc.source.width}×${state.doc.source.height} · ${flattenLayers(state.doc.layers).length} shapes` : null}
      />
      <UpdateNotice />
    </div>
  );
}
