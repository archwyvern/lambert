import { useEffect, useRef, useState } from "react";
import type { DocumentStore, EditorState } from "../document/store";
import { addShape, updateShape } from "../document/docOps";
import { v2, Vec2 } from "../field/vec";
import { Gizmos } from "./Gizmos";
import { pickShape } from "./picking";
import { PreviewRenderer } from "./preview";
import { fitViewport, screenToCanvas, Viewport, zoomAt } from "./viewport";
import type { ViewState } from "./App";

type Drag =
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "move"; id: string; startCanvas: Vec2; startPos: Vec2 };

export function CanvasView(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  diffuseBytes: Uint8Array | null;
}): React.JSX.Element {
  const { store, state, view, diffuseBytes } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const doc = state.doc;

  // init renderer + canvas sizing
  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    const resize = (): void => {
      const r = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(r.height * devicePixelRatio));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    void PreviewRenderer.create(canvas)
      .then((r) => {
        rendererRef.current = r;
        setReady(true);
      })
      .catch((err: unknown) => setGpuError(err instanceof Error ? err.message : String(err)));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // upload diffuse when it changes; refit the view to the (possibly new) doc dims
  useEffect(() => {
    if (!ready || !rendererRef.current || !diffuseBytes) return;
    rendererRef.current.setDiffuse(diffuseBytes, doc.source.width, doc.source.height);
    const rect = hostRef.current!.getBoundingClientRect();
    setViewport(fitViewport(doc.source.width, doc.source.height, rect.width, rect.height, 40));
  }, [ready, diffuseBytes, doc.source.width, doc.source.height]);

  // render on any relevant change (rAF-coalesced inside the renderer)
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !diffuseBytes || !ready) return;
    const maxH = doc.shapes.reduce(
      (m, s) => Math.max(m, Math.abs(Number(s.params.height ?? s.params.depth ?? 0))),
      8,
    );
    r.requestRender(doc.source.width, doc.source.height, {
      shapes: doc.shapes,
      viewport,
      mode: view.mode,
      opacity: view.opacity,
      lightDir: view.lightDir,
      heightRange: [-maxH, maxH],
    });
  });

  const toCanvasPoint = (e: React.PointerEvent): Vec2 => {
    const rect = hostRef.current!.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.button === 1 || e.shiftKey) {
      dragRef.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
      return;
    }
    const p = toCanvasPoint(e);
    const hit = pickShape(doc.shapes, p);
    store.select(hit?.id ?? null);
    if (hit) dragRef.current = { kind: "move", id: hit.id, startCanvas: p, startPos: hit.transform.pos };
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const cp = toCanvasPoint(e);
    setCursor(v2(Math.floor(cp.x), Math.floor(cp.y)));
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      setViewport((vp) => ({ ...vp, panX: vp.panX + e.clientX - drag.lastX, panY: vp.panY + e.clientY - drag.lastY }));
      dragRef.current = { ...drag, lastX: e.clientX, lastY: e.clientY };
      return;
    }
    const p = toCanvasPoint(e);
    const dx = p.x - drag.startCanvas.x;
    const dy = p.y - drag.startCanvas.y;
    store.update(
      (d) =>
        updateShape(d, drag.id, (s) => ({
          ...s,
          transform: { ...s.transform, pos: v2(drag.startPos.x + dx, drag.startPos.y + dy) },
        })),
      { coalesce: `move:${drag.id}` },
    );
  };

  const endDrag = (): void => {
    dragRef.current = null;
    store.endGesture();
  };

  const onWheel = (e: React.WheelEvent): void => {
    const rect = hostRef.current!.getBoundingClientRect();
    setViewport((vp) => zoomAt(vp, v2(e.clientX - rect.left, e.clientY - rect.top), e.deltaY < 0 ? 1.2 : 1 / 1.2));
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    if (!diffuseBytes) return; // no document: nothing to author against
    const typeId = e.dataTransfer.getData("application/x-flatland-shape");
    if (!typeId) return;
    const rect = hostRef.current!.getBoundingClientRect();
    const p = screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
    store.update((d) => addShape(d, typeId, p));
    store.endGesture();
  };

  // viewport keyboard: Ctrl+0 = fit, Ctrl+1 = 100%
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "0" && e.key !== "1") return;
      e.preventDefault();
      const rect = hostRef.current!.getBoundingClientRect();
      if (e.key === "0") {
        setViewport(fitViewport(doc.source.width, doc.source.height, rect.width, rect.height, 40));
      } else {
        setViewport({
          zoom: 1,
          panX: (rect.width - doc.source.width) / 2,
          panY: (rect.height - doc.source.height) / 2,
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc.source.width, doc.source.height]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {gpuError ? (
        <div className="absolute inset-0 grid place-items-center bg-bg">GPU unavailable: {gpuError}</div>
      ) : null}
      {!diffuseBytes && !gpuError ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="border border-border bg-surface px-6 py-4 text-center">
            <div className="text-md font-semibold text-accent">No document</div>
            <p className="mt-1 text-sm text-fg-mid">
              Open a diffuse image (or an existing project) from the toolbar to start.
            </p>
          </div>
        </div>
      ) : null}
      <Gizmos doc={doc} selectedId={state.selectedId} viewport={viewport} store={store} />
      {diffuseBytes ? (
        <div className="pointer-events-none absolute bottom-2 left-2 flex gap-3 border border-border bg-surface2/90 px-2 py-0.5 text-sm tabular-nums text-fg-mid">
          <span title="Zoom (Ctrl+0 fit, Ctrl+1 100%)" className="text-fg">
            {Math.round(viewport.zoom * 100)}%
          </span>
          {cursor ? (
            <span>
              {cursor.x}, {cursor.y}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
