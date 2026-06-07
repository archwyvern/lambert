import "./styles.css";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DocumentStore } from "../document/store";
import { duplicateShape, removeShape, updateShape } from "../document/docOps";
import { emptyDoc } from "../document/schema";
import { exportNx, openImageFlow, openProjectFlow, saveFlow } from "../document/io";
import { v2 } from "../field/vec";
import { CanvasView } from "./CanvasView";
import { getHost } from "./host";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { Toast, ToastState } from "./kit";
import { Toolbar } from "./Toolbar";
import type { ViewMode } from "./preview";
import { VIEW_MODES } from "./preview";

export interface ViewState {
  mode: ViewMode;
  /** Overlay opacity for height/normal views (1 = 100%). */
  opacity: number;
  lightDir: [number, number, number];
}

export function App(): React.JSX.Element {
  const store = useMemo(() => new DocumentStore(emptyDoc("untitled.png", 256, 256), null), []);
  const state = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.state,
  );
  const [view, setView] = useState<ViewState>({ mode: "lit", opacity: 1, lightDir: [-0.5, -0.5, 0.7] });
  const [diffuse, setDiffuse] = useState<{ bytes: Uint8Array; dir: string | null } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (msg: string, tone: ToastState["tone"] = "info"): void => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, tone });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const run = (p: Promise<unknown>): void =>
    void p
      .then((msg) => {
        if (typeof msg === "string") notify(msg);
      })
      .catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), "error"));

  // close guard: main intercepts window close once we register; confirm when dirty
  useEffect(() => {
    const host = getHost();
    host.guardClose();
    host.onConfirmClose(() => {
      const ok = !store.state.dirty || confirm("Unsaved changes — close anyway?");
      host.respondClose(ok);
    });
  }, [store]);

  // demo bootstrap for automated captures: ?demo=1&mode=<viewmode>&select=<shapeid>
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has("demo")) return;
    void Promise.all([import("fast-png"), import("../field/fixtures")]).then(([{ encode }, { goldenShapes }]) => {
      const w = 96;
      const h = 96;
      const data = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = 96;
        data[i * 4 + 1] = 104;
        data[i * 4 + 2] = 118;
        data[i * 4 + 3] = 255;
      }
      const doc = { ...emptyDoc("demo.png", w, h), shapes: goldenShapes() };
      store.reset(doc, null);
      setDiffuse({ bytes: encode({ width: w, height: h, data }), dir: null });
      const mode = q.get("mode");
      if (mode && (VIEW_MODES as string[]).includes(mode)) setView((v) => ({ ...v, mode: mode as ViewMode }));
      const select = q.get("select");
      if (select) store.select(doc.shapes.find((s) => s.id === select)?.id ?? doc.shapes[0]?.id ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // file ops fire regardless of focus; editing keys defer to form controls
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "s") {
          e.preventDefault();
          if (diffuse) run(saveFlow(getHost(), store, e.shiftKey));
          return;
        }
        if (k === "o") {
          e.preventDefault();
          run(e.shiftKey ? openProjectFlow(getHost(), store, setDiffuse) : openImageFlow(getHost(), store, setDiffuse));
          return;
        }
        if (k === "e") {
          e.preventDefault();
          if (diffuse) run(exportNx(getHost(), store));
          return;
        }
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const id = store.state.selectedId;
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") store.redo();
      else if (e.ctrlKey && e.key.toLowerCase() === "d" && id) {
        e.preventDefault();
        store.update((d) => duplicateShape(d, id));
        store.endGesture();
      } else if ((e.key === "Delete" || e.key === "Backspace") && id) {
        store.update((d) => removeShape(d, id));
        store.endGesture();
      } else if (e.key.toLowerCase() === "v" && !e.ctrlKey) {
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
              transform: { ...s.transform, pos: v2(s.transform.pos.x + dx, s.transform.pos.y + dy) },
            })),
          { coalesce: `nudge:${id}` },
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, diffuse]);

  return (
    <div className="flex h-screen flex-col bg-bg text-sm text-fg">
      <Toolbar
        store={store}
        state={state}
        view={view}
        setView={setView}
        diffuse={diffuse}
        setDiffuse={setDiffuse}
        run={run}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 overflow-y-auto border-r border-border bg-surface p-3">
          <Library enabled={!!diffuse} />
        </aside>
        <main className="relative min-w-0 flex-1 bg-[var(--color-viewport-bg)]">
          <CanvasView store={store} state={state} view={view} diffuseBytes={diffuse?.bytes ?? null} />
        </main>
        <aside className="w-72 overflow-y-auto border-l border-border bg-surface p-3">
          <Inspector store={store} state={state} />
        </aside>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
