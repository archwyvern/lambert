import "./styles.css";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DocumentStore } from "../document/store";
import { duplicateShape, removeShape, updateShape } from "../document/docOps";
import { emptyDoc } from "../document/schema";
import { v2 } from "../field/vec";
import { CanvasView } from "./CanvasView";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { Toolbar } from "./Toolbar";
import type { ViewMode } from "./preview";
import { VIEW_MODES } from "./preview";

export interface ViewState {
  mode: ViewMode;
  onion: number;
  lightDir: [number, number, number];
}

export function App(): React.JSX.Element {
  const store = useMemo(() => new DocumentStore(emptyDoc("untitled.png", 256, 256), null), []);
  const state = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.state,
  );
  const [view, setView] = useState<ViewState>({ mode: "lit", onion: 0.35, lightDir: [-0.5, -0.5, 0.7] });
  const [diffuse, setDiffuse] = useState<{ bytes: Uint8Array; dir: string | null } | null>(null);

  // demo bootstrap for automated captures: ?demo=1&mode=<viewmode>
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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
  }, [store]);

  return (
    <div className="flex h-screen flex-col bg-canvasbg text-sm text-fg">
      <Toolbar store={store} state={state} view={view} setView={setView} diffuse={diffuse} setDiffuse={setDiffuse} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 overflow-y-auto border-r border-panel-edge bg-panel p-2">
          <Library />
        </aside>
        <main className="relative min-w-0 flex-1">
          <CanvasView store={store} state={state} view={view} diffuseBytes={diffuse?.bytes ?? null} />
        </main>
        <aside className="w-72 overflow-y-auto border-l border-panel-edge bg-panel p-2">
          <Inspector store={store} state={state} />
        </aside>
      </div>
    </div>
  );
}
