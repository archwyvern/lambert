import "./styles.css";
import { useEffect, useReducer, useRef, useState } from "react";
import { DocumentStore } from "../document/store";
import { addShape, duplicateShape, removeShape, updateShape } from "../document/docOps";
import { deleteVerts } from "../field/meshOps";
import { emptyDoc, NormalDirs, parseProjectConfig, serializeProjectConfig } from "../document/schema";
import { exportTabNx, hasSidecar, newProjectFlow, openImageTab, openProjectFlow, saveTab } from "../document/io";
import { basename, dirname, joinPath } from "../document/paths";
import { buildSessionJson, parseSessionJson } from "../document/session";
import { PROJECT_FILE, Tab, Workspace } from "../document/workspace";
import { CanvasView } from "./CanvasView";
import { Preview3D } from "./Preview3D";
import { use3DCamera } from "./use3DCamera";
import { ToolPalette } from "./ToolPalette";
import { getHost } from "./host";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { Library } from "./Library";
import { Tabs } from "./Tabs";
import { Button, SectionLabel, StatusBar, ToastState } from "./kit";
import { FileExplorer } from "@carapace/shell";
import type { DirEntry, FileExplorerProps } from "@carapace/shell";
import { DocumentRegular, FolderRegular, ImageRegular } from "@fluentui/react-icons";
import { usePersistentState } from "./persist";
import { Sash } from "./Sash";
import { Toolbar } from "./Toolbar";
import type { ViewMode } from "./preview";
import { VIEW_MODES } from "./preview";
import { TOOL_KEYS, ToolMode } from "./tools";
import { v2 } from "../field/vec";

const clampPanel = (w: number): number => Math.min(480, Math.max(160, w));

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
  /** Raster view: the pixelated exported output instead of the crisp display-res vector view. */
  raster: boolean;
}

const DEFAULT_VIEW: ViewState = { mode: "lit", opacity: 1, lightDir: [-0.5, -0.5, 0.7], raster: false };

export function App(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [views, setViews] = useState<Record<string, ViewState>>({});
  const [tool, setTool] = useState<ToolMode>("select");
  const [selVerts, setSelVerts] = useState<number[]>([]);
  const selVertsRef = useRef(selVerts);
  selVertsRef.current = selVerts;
  const [leftWidth, setLeftWidth] = usePersistentState("panel:left", 220);
  const [rightWidth, setRightWidth] = usePersistentState("panel:right", 288);
  const [toast, setToast] = useState<ToastState | null>(null);
  const cam3d = use3DCamera();
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const [swapped, setSwapped] = usePersistentState("panel:3d:swapped", false);
  const cornerHeight = 300;
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const active = workspace?.active ?? null;
  const state = active?.store.state ?? null;

  const notify = (msg: string, tone: ToastState["tone"] = "info"): void => setToast({ msg, tone });
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

  // stable refs for the menu/keydown/close listeners (registered once)
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const viewsRef = useRef(views);
  viewsRef.current = views;

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
        setViews((vs) => (vs[imagePath] ? vs : { ...vs, [imagePath]: { ...DEFAULT_VIEW } }));
        ws.openTab(tab);
      })(),
    );
  };

  const closeImage = (imagePath: string): void => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const t = ws.tabs[ws.indexOf(imagePath)];
    if (t?.store.state.dirty && !confirm(`${basename(imagePath)} has unsaved changes — close anyway?`)) return;
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

  // add a shape from the library popover, centred in the document
  const pickShape = (typeId: string): void => {
    const t = workspaceRef.current?.active;
    if (!t) return;
    const { width, height } = t.store.state.doc.source;
    t.store.update((d) => addShape(d, typeId, v2(width / 2, height / 2)));
    const shapes = t.store.state.doc.shapes;
    t.store.select(shapes[shapes.length - 1]?.id ?? null);
    t.store.endGesture();
  };

  const buildStash = (): string | null => {
    const ws = workspaceRef.current;
    if (!ws) return null;
    const vs = viewsRef.current;
    return buildSessionJson({
      projectPath: ws.projectPath,
      activeIndex: ws.activeIndex,
      tabs: ws.tabs.map((t) => ({
        imagePath: t.imagePath,
        docPath: t.docPath,
        dirty: t.store.state.dirty,
        doc: t.store.state.doc,
        view: vs[t.imagePath] ?? DEFAULT_VIEW,
      })),
    });
  };

  // application-menu actions (accelerators live in the menu, not in keydown)
  useEffect(() => {
    getHost().onMenuAction((action) => {
      const t = workspaceRef.current?.active;
      const id = t?.store.state.selectedId;
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
          if (t && id) {
            t.store.update((d) => duplicateShape(d, id));
            t.store.endGesture();
          }
          return;
        case "delete":
          if (t && id) {
            t.store.update((d) => removeShape(d, id));
            t.store.endGesture();
          }
          return;
        case "zoom-fit":
        case "zoom-100":
          window.dispatchEvent(new CustomEvent("lambert-zoom", { detail: action }));
          return;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close guard: confirm when any tab is dirty, and flush the session stash before closing
  useEffect(() => {
    const host = getHost();
    host.guardClose();
    host.onConfirmClose(() => {
      const ws = workspaceRef.current;
      const anyDirty = ws?.tabs.some((t) => t.store.state.dirty) ?? false;
      const ok = !anyDirty || confirm("Unsaved changes — close anyway?");
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
        for (const ts of s.tabs) {
          const bytes = await host.readFile(ts.imagePath);
          const store = new DocumentStore(ts.doc, ts.docPath);
          if (ts.dirty) store.reset(ts.doc, ts.docPath, { dirty: true });
          const tab: Tab = { imagePath: ts.imagePath, docPath: ts.docPath, store, diffuse: { bytes, dir: dirname(ts.imagePath) } };
          ws.openTab(tab);
          restoredViews[ts.imagePath] = ts.view;
        }
        if (ws.tabs.length > 0) ws.activeIndex = Math.min(Math.max(0, s.activeIndex), ws.tabs.length - 1);
        setWorkspace(ws);
        setViews(restoredViews);
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
  }, [workspace, active, views]);

  // demo bootstrap for automated captures: a one-tab in-memory project
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has("demo")) return;
    void Promise.all([import("fast-png"), import("../field/fixtures"), import("../field/meshConvert")])
      .then(([{ encode }, { goldenShapes }, { convertToMesh }]) => {
        const w = 96;
        const h = 96;
        const data = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          data[i * 4] = 96;
          data[i * 4 + 1] = 104;
          data[i * 4 + 2] = 118;
          data[i * 4 + 3] = 255;
        }
        const shapes = goldenShapes().map((s) => (q.has("mesh") && s.id === "slab" ? convertToMesh(s) : s));
        const doc = { ...emptyDoc("demo.png", w, h), shapes };
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
        if (select) tab.store.select(doc.shapes.find((s) => s.id === select)?.id ?? doc.shapes[0]?.id ?? null);
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
      } else if ((e.key === "Delete" || e.key === "Backspace") && id) {
        const shape = store.state.doc.shapes.find((s) => s.id === id);
        const verts = selVertsRef.current;
        if (shape?.mesh && verts.length > 0) {
          store.update((d) =>
            updateShape(d, id, (s) => {
              if (!s.mesh) return s;
              const r = deleteVerts(s.controlPoints, s.mesh, verts);
              return r ? { ...s, controlPoints: r.controlPoints, mesh: r.mesh } : s;
            }),
          );
          setSelVerts([]);
        } else {
          store.update((d) => removeShape(d, id));
        }
        store.endGesture();
      } else if (key === "v") {
        setActiveView((s) => ({ ...s, mode: VIEW_MODES[(VIEW_MODES.indexOf(s.mode) + 1) % VIEW_MODES.length]! }));
      } else if (e.key.startsWith("Arrow") && id) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        store.update(
          (d) =>
            updateShape(d, id, (s) => ({
              ...s,
              transform: { ...s.transform, pos: s.transform.pos.withX(s.transform.pos.x + dx).withY(s.transform.pos.y + dy) },
            })),
          { coalesce: `nudge:${id}` },
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabInfos = workspace
    ? workspace.tabs.map((t) => ({ imagePath: t.imagePath, name: basename(t.imagePath), dirty: t.store.state.dirty }))
    : [];

  return (
    <div className="flex h-screen flex-col bg-bg text-base text-fg">
      {active && state ? (
        <Toolbar store={active.store} state={state} view={activeView} setView={setActiveView} />
      ) : (
        <div className="flex h-[38px] shrink-0 items-center border-b border-border bg-surface2 px-3 text-base font-semibold tracking-wide text-fg-mid">
          Lambert
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col gap-3 bg-bg p-3" style={{ width: leftWidth }}>
          <Library enabled={!!active} onPick={pickShape} />
          {active && state ? <Layers store={active.store} state={state} /> : null}
          {workspace ? (
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
                  exclude={(e) => e.isDir && IGNORED_DIRS.has(e.name)}
                  ariaLabel="Project files"
                />
              </div>
            </div>
          ) : null}
        </aside>
        {active ? <ToolPalette tool={tool} setTool={setTool} /> : null}
        <Sash onDrag={(dx) => setLeftWidth((w) => clampPanel(w + dx))} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Tabs
            tabs={tabInfos}
            activeIndex={workspace?.activeIndex ?? -1}
            onSelect={(i) => workspaceRef.current?.focus(workspaceRef.current.tabs[i]!.imagePath)}
            onClose={closeImage}
          />
          {active && state ? (
            <div
              className="grid min-h-0 flex-1"
              style={{
                gridTemplateColumns: `minmax(0, 1fr) auto ${rightWidth}px`,
                gridTemplateRows: `minmax(0, 1fr) ${cornerHeight}px`,
                gridTemplateAreas: '"big sash inspector" "big sash corner"',
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
                  canvas3dRef={canvas3dRef}
                  orbit3d={cam3d.orbit}
                  normalDirs={workspace!.config.normalDirs}
                />
              </main>
              <div className="flex" style={{ gridArea: "sash" }}>
                <Sash onDrag={(dx) => setRightWidth((w) => clampPanel(w - dx))} />
              </div>
              <aside className="overflow-y-auto bg-bg p-3" style={{ gridArea: "inspector" }}>
                <Inspector
                  store={active.store}
                  state={state}
                  selVerts={selVerts}
                  normalDirs={workspace!.config.normalDirs}
                  onNormalDirs={setNormalDirs}
                />
              </aside>
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
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-[var(--color-viewport-bg)] text-fg-mid">
              <p className="text-base">{workspace ? "Open an image from the Explorer." : "No project open."}</p>
              {workspace ? null : (
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => openProject("new")}>
                    New Project
                  </Button>
                  <Button variant="ghost" onClick={() => openProject("open")}>
                    Open Project
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <StatusBar
        message={toast}
        right={state ? `${state.doc.source.width}×${state.doc.source.height} · ${state.doc.shapes.length} shapes` : null}
      />
    </div>
  );
}
