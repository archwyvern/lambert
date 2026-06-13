import "./styles.css";
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { DocumentStore } from "../document/store";
import { duplicateShape, removeShape, updateShape } from "../document/docOps";
import { deleteVerts } from "../field/meshOps";
import { emptyDoc } from "../document/schema";
import { diffusePathByStore, exportNx, openImageFlow, openProjectFlow, saveFlow } from "../document/io";
import { dirname } from "../document/paths";
import { buildSessionJson, parseSessionJson } from "../document/session";
import { CanvasView } from "./CanvasView";
import { Preview3D } from "./Preview3D";
import { use3DCamera } from "./use3DCamera";
import { ToolPalette } from "./ToolPalette";
import { getHost } from "./host";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { Library } from "./Library";
import { StatusBar, ToastState } from "./kit";
import { usePersistentState } from "./persist";
import { Sash } from "./Sash";
import { Toolbar } from "./Toolbar";
import type { ViewMode } from "./preview";
import { VIEW_MODES } from "./preview";
import { TOOL_KEYS, ToolMode } from "./tools";

const clampPanel = (w: number): number => Math.min(480, Math.max(160, w));

export interface ViewState {
  mode: ViewMode;
  /** Overlay opacity for the normal view (1 = 100%). */
  opacity: number;
  lightDir: [number, number, number];
  /** Raster view: the pixelated exported output instead of the crisp display-res vector view. */
  raster: boolean;
}

export function App(): React.JSX.Element {
  const store = useMemo(() => new DocumentStore(emptyDoc("untitled.png", 256, 256), null), []);
  const state = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.state,
  );
  const [view, setView] = useState<ViewState>({ mode: "lit", opacity: 1, lightDir: [-0.5, -0.5, 0.7], raster: false });
  const [tool, setTool] = useState<ToolMode>("select");
  // selected control-point indices (shared: the canvas marquee/handles drive it); cleared
  // whenever the selected shape changes
  const [selVerts, setSelVerts] = useState<number[]>([]);
  const selVertsRef = useRef(selVerts); // live read inside the stable keydown listener
  selVertsRef.current = selVerts;
  const [diffuse, setDiffuse] = useState<{ bytes: Uint8Array; dir: string | null } | null>(null);
  const [leftWidth, setLeftWidth] = usePersistentState("panel:left", 208);
  const [rightWidth, setRightWidth] = usePersistentState("panel:right", 288);
  const [toast, setToast] = useState<ToastState | null>(null);
  // 3D preview lives in the right column under the inspector; Space swaps it with the centre.
  // Owned here (not CanvasView) so it can occupy either slot — CanvasView's renderer just
  // attaches the canvas and feeds it the orbit.
  const cam3d = use3DCamera();
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const [swapped, setSwapped] = usePersistentState("panel:3d:swapped", false);
  const cornerHeight = 300;
  // bumped when the 3D canvas changes size (swap fullscreen <-> corner) so CanvasView's render
  // effect re-fires and the orbit pass renders at the NEW resolution — otherwise the old, smaller
  // framebuffer is shown stretched (pixelated) until the camera next moves
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);

  // status messages land in the bottom bar (not a popup); the last one persists until replaced
  const notify = (msg: string, tone: ToastState["tone"] = "info"): void => setToast({ msg, tone });

  useEffect(() => setSelVerts([]), [state.selectedId]);

  const run = (p: Promise<unknown>): void =>
    void p
      .then((msg) => {
        if (typeof msg === "string") notify(msg);
      })
      .catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), "error"));

  // latest values for the stable menu/close listeners
  const viewRef = useRef(view);
  viewRef.current = view;
  const diffuseRef = useRef(diffuse);
  diffuseRef.current = diffuse;

  const buildStash = (): string | null => {
    const diffusePath = diffusePathByStore.get(store);
    if (!diffusePath) return null; // demo or no document: nothing to remember
    return buildSessionJson({
      doc: store.state.doc,
      docPath: store.state.docPath,
      diffusePath,
      dirty: store.state.dirty,
      view: viewRef.current,
    });
  };

  // application-menu actions (accelerators live in the menu, not in keydown)
  useEffect(() => {
    getHost().onMenuAction((action) => {
      const id = store.state.selectedId;
      switch (action) {
        case "open-image":
          return run(openImageFlow(getHost(), store, setDiffuse));
        case "open-project":
          return run(openProjectFlow(getHost(), store, setDiffuse));
        case "save":
          return diffuseRef.current ? run(saveFlow(getHost(), store, false)) : undefined;
        case "save-as":
          return diffuseRef.current ? run(saveFlow(getHost(), store, true)) : undefined;
        case "export-nx":
          return diffuseRef.current ? run(exportNx(getHost(), store)) : undefined;
        case "undo":
          return store.undo();
        case "redo":
          return store.redo();
        case "duplicate":
          if (id) {
            store.update((d) => duplicateShape(d, id));
            store.endGesture();
          }
          return;
        case "delete":
          if (id) {
            store.update((d) => removeShape(d, id));
            store.endGesture();
          }
          return;
        case "zoom-fit":
        case "zoom-100":
          window.dispatchEvent(new CustomEvent("lambert-zoom", { detail: action }));
          return;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // close guard: main intercepts window close once we register; confirm when dirty,
  // and flush the session stash before letting the window go
  useEffect(() => {
    const host = getHost();
    host.guardClose();
    host.onConfirmClose(() => {
      const ok = !store.state.dirty || confirm("Unsaved changes — close anyway?");
      const stash = ok ? buildStash() : null;
      if (stash) void host.saveSession(stash).finally(() => host.respondClose(true));
      else host.respondClose(ok);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // session restore: reopen whatever was being worked on when the app last closed
  useEffect(() => {
    if (new URLSearchParams(location.search).has("demo")) return;
    void (async () => {
      try {
        const json = await getHost().loadSession();
        if (!json) return;
        const session = parseSessionJson(json);
        const bytes = await getHost().readFile(session.diffusePath);
        store.reset(session.doc, session.docPath, { dirty: session.dirty });
        diffusePathByStore.set(store, session.diffusePath);
        setDiffuse({ bytes, dir: dirname(session.diffusePath) });
        setView(session.view);
        notify(`Restored ${session.docPath ?? session.diffusePath}`);
      } catch {
        // no session, corrupt session, or the diffuse moved: start fresh
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // continuous stash (doubles as crash recovery): debounce a second after any change
  const stashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!diffuse) return;
    const schedule = (): void => {
      if (stashTimer.current) clearTimeout(stashTimer.current);
      stashTimer.current = setTimeout(() => {
        const stash = buildStash();
        if (stash) void getHost().saveSession(stash);
      }, 1000);
    };
    schedule();
    const unsub = store.subscribe(schedule);
    return () => {
      unsub();
      if (stashTimer.current) clearTimeout(stashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, diffuse, view]);

  // demo bootstrap for automated captures: ?demo=1&mode=<viewmode>&select=<shapeid>
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
      // ?mesh converts the slab to a mesh plane (capture/demo aid)
      const shapes = goldenShapes().map((s) => (q.has("mesh") && s.id === "slab" ? convertToMesh(s) : s));
      const doc = { ...emptyDoc("demo.png", w, h), shapes };
      store.reset(doc, null);
      setDiffuse({ bytes: encode({ width: w, height: h, data }), dir: null });
      const mode = q.get("mode");
      if (mode && (VIEW_MODES as string[]).includes(mode)) setView((v) => ({ ...v, mode: mode as ViewMode }));
      if (q.has("raster")) setView((v) => ({ ...v, raster: true }));
      if (q.has("swap")) setSwapped(true);
      const select = q.get("select");
      if (select) store.select(doc.shapes.find((s) => s.id === select)?.id ?? doc.shapes[0]?.id ?? null);
      const t = q.get("tool");
      if (t && t in TOOL_KEYS) setTool(TOOL_KEYS[t]!);
      const markReady = (): void => {
        (window as unknown as { __lambertDemoReady?: boolean }).__lambertDemoReady = true;
      };
      // ?cmenu: select two verts and pop the vertex context menu (capture aid for the menu)
      if (q.has("cmenu")) {
        const onEdge = q.get("cmenu") === "edge";
        // stage 1: select two verts (after the shape-select effect has cleared the vertex selection)
        setTimeout(() => {
          if (!onEdge) setSelVerts([0, 2]);
          // stage 2: once committed + re-rendered the handles, synthesize the right-click
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
      const id = store.state.selectedId;
      const key = e.key.toLowerCase();
      if (e.code === "Space") {
        e.preventDefault();
        setSwapped((s) => !s);
      } else if (key in TOOL_KEYS) {
        setTool(TOOL_KEYS[key]!);
      } else if ((e.key === "Delete" || e.key === "Backspace") && id) {
        // on a mesh with vertices selected, Delete removes those vertices; otherwise the shape
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
        setView((s) => ({ ...s, mode: VIEW_MODES[(VIEW_MODES.indexOf(s.mode) + 1) % VIEW_MODES.length]! }));
      } else if (e.key.startsWith("Arrow") && id) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        store.update(
          (d) =>
            updateShape(d, id, (s) => ({
              ...s,
              transform: { ...s.transform, pos: { ...s.transform.pos, x: s.transform.pos.x + dx, y: s.transform.pos.y + dy } },
            })),
          { coalesce: `nudge:${id}` },
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  return (
    <div className="flex h-screen flex-col bg-bg text-base text-fg">
      <Toolbar store={store} state={state} view={view} setView={setView} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col gap-4 bg-bg p-3" style={{ width: leftWidth }}>
          <Library enabled={!!diffuse} />
          <Layers store={store} state={state} />
        </aside>
        <ToolPalette tool={tool} setTool={setTool} />
        <Sash onDrag={(dx) => setLeftWidth((w) => clampPanel(w + dx))} />
        {/* stage grid: a big slot (centre) + the right column (inspector over a corner slot).
            Space swaps which view sits in `big` vs `corner` by flipping grid-area — both views
            stay mounted so the WebGPU renderer is never torn down. */}
        <div
          className="grid min-w-0 flex-1"
          style={{
            gridTemplateColumns: `minmax(0, 1fr) auto ${rightWidth}px`,
            gridTemplateRows: `minmax(0, 1fr) ${cornerHeight}px`,
            gridTemplateAreas: '"big sash inspector" "big sash corner"',
          }}
        >
          {/* 2D editor stays full-size in the centre always; when 3D is swapped to fullscreen
              it just gets overlaid (Preview3D moves into "big" on top), so its camera is never
              disturbed by a resize. */}
          <main className="relative min-w-0 overflow-hidden bg-[var(--color-viewport-bg)]" style={{ gridArea: "big" }}>
            <CanvasView
              store={store}
              state={state}
              view={view}
              tool={tool}
              diffuseBytes={diffuse?.bytes ?? null}
              selVerts={selVerts}
              setSelVerts={setSelVerts}
              onLightChange={(d) => setView((v) => ({ ...v, lightDir: d }))}
              canvas3dRef={canvas3dRef}
              orbit3d={cam3d.orbit}
            />
          </main>
          <div className="flex" style={{ gridArea: "sash" }}>
            <Sash onDrag={(dx) => setRightWidth((w) => clampPanel(w - dx))} />
          </div>
          <aside className="overflow-y-auto bg-bg p-3" style={{ gridArea: "inspector" }}>
            <Inspector store={store} state={state} selVerts={selVerts} />
          </aside>
          {/* blank box left in the corner when the 3D is swapped out to fullscreen */}
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
              enabled={!!diffuse}
              onResize={bumpRender}
            />
          </div>
        </div>
      </div>
      <StatusBar
        message={toast}
        right={diffuse ? `${state.doc.source.width}×${state.doc.source.height} · ${state.doc.shapes.length} shapes` : null}
      />
    </div>
  );
}
