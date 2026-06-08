import { useEffect, useRef, useState } from "react";
import type { DocumentStore, EditorState } from "../document/store";
import { addShape, updateShape } from "../document/docOps";
import { getShapeType } from "../field/registry";
import { createSurface } from "../field/surfaceOps";
import { fromLocal } from "../field/transform";
import { normalSigns } from "../document/schema";
import { v2, Vec2 } from "../field/vec";
import { Gizmos } from "./Gizmos";
import { LightPad } from "./LightPad";
import { axisScaleFromDrag, constrainAxis, pickShape, pointsInBox, rotationFromDrag, snapAngle } from "./picking";
import { PreviewRenderer } from "./preview";
import { Surfaces } from "./Surfaces";
import { canvasToScreen, fitViewport, screenToCanvas, Viewport, zoomAt } from "./viewport";
import type { ToolMode } from "./tools";
import type { ViewState } from "./App";

const ROTATE_SNAP = Math.PI / 12; // 15 deg, godot default rotation snap step

type Drag =
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "move"; id: string; startCanvas: Vec2; startPos: { x: number; y: number } }
  | { kind: "rotate"; id: string; startCanvas: Vec2; startRotation: number; pivot: Vec2 }
  | {
      kind: "scale";
      id: string;
      startCanvas: Vec2;
      startScale: { x: number; y: number; z: number };
      pivot: Vec2;
      rotation: number;
    }
  | { kind: "marquee"; startCanvas: Vec2; current: Vec2; additive: boolean; base: number[]; moved: boolean };

export function CanvasView(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  tool: ToolMode;
  diffuseBytes: Uint8Array | null;
  selVerts: number[];
  setSelVerts: (v: number[] | ((p: number[]) => number[])) => void;
  onLightChange: (dir: [number, number, number]) => void;
}): React.JSX.Element {
  const { store, state, view, tool, diffuseBytes, selVerts, setSelVerts, onLightChange } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [penDraft, setPenDraft] = useState<Vec2[] | null>(null); // in-progress pen loop (canvas px)
  const [penCursor, setPenCursor] = useState<Vec2 | null>(null);

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

  // leaving the pen tool (or pressing Escape) abandons any in-progress loop
  useEffect(() => {
    if (tool !== "pen") setPenDraft(null);
  }, [tool]);
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPenDraft(null);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  // space = temporary pan (godot-style); tracked outside react state for the drag handlers
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) spaceRef.current = true;
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // menu-driven zoom (accelerators are owned by the application menu)
  useEffect(() => {
    const onZoom = (e: Event): void => {
      const action = (e as CustomEvent<string>).detail;
      const rect = hostRef.current!.getBoundingClientRect();
      if (action === "zoom-fit") {
        setViewport(fitViewport(doc.source.width, doc.source.height, rect.width, rect.height, 40));
      } else if (action === "zoom-100") {
        setViewport({
          zoom: 1,
          panX: (rect.width - doc.source.width) / 2,
          panY: (rect.height - doc.source.height) / 2,
        });
      }
    };
    window.addEventListener("flatland-zoom", onZoom);
    return () => window.removeEventListener("flatland-zoom", onZoom);
  }, [doc.source.width, doc.source.height]);

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
      (m, s) =>
        Math.max(
          m,
          Math.abs(s.transform.pos.z) + (getShapeType(s.typeId).nominalHeight ?? 0) * Math.abs(s.transform.scale.z),
        ),
      8,
    );
    r.requestRender(doc.source.width, doc.source.height, {
      shapes: doc.shapes,
      viewport,
      mode: view.mode,
      opacity: view.opacity,
      lightDir: view.lightDir,
      heightRange: [-maxH, maxH],
      normalSigns: normalSigns(doc.normalDirs),
    });
  });

  const toCanvasPoint = (e: React.PointerEvent): Vec2 => {
    const rect = hostRef.current!.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceRef.current) {
      dragRef.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const p = toCanvasPoint(e);

    if (tool === "pen") {
      // click drops vertices; clicking near the first one (>=3 verts) closes the loop into a
      // filled surface. Stays in pen mode so you can draw the next one.
      const draft = penDraft ?? [];
      if (draft.length >= 3 && Math.hypot(p.x - draft[0]!.x, p.y - draft[0]!.y) * viewport.zoom < 10) {
        const surf = createSurface(draft);
        store.update((d) => ({ ...d, shapes: [...d.shapes, surf] }));
        store.endGesture();
        store.select(surf.id);
        setPenDraft(null);
      } else {
        setPenDraft([...draft, p]);
      }
      return;
    }

    // godot select-mode modifier overrides: alt=move, ctrl=rotate, ctrl+alt=scale
    const override =
      tool === "select"
        ? e.ctrlKey && e.altKey
          ? "scale"
          : e.ctrlKey
            ? "rotate"
            : e.altKey
              ? "move"
              : null
        : null;
    const effective: ToolMode = override ?? tool;

    const beginMarquee = (): void => {
      dragRef.current = {
        kind: "marquee",
        startCanvas: p,
        current: p,
        additive: e.shiftKey,
        base: e.shiftKey ? selVerts : [],
        moved: false,
      };
    };

    if (tool === "vertex") {
      // vertex tool: the body never grabs drags. Clicking a different shape picks it for
      // editing; otherwise any drag is a marquee (works over the body too — solves interior
      // verts). Clicking a vertex dot is handled by the gizmo (it stops propagation).
      const hit = pickShape(doc.shapes, p);
      if (hit && hit.id !== state.selectedId) {
        store.select(hit.id);
        return;
      }
      beginMarquee();
      return;
    }

    if (effective === "select") {
      // only the pointer picks by clicking; other tools select via the layer panel
      const hit = pickShape(doc.shapes, p);
      if (hit) {
        store.select(hit.id);
        dragRef.current = { kind: "move", id: hit.id, startCanvas: p, startPos: hit.transform.pos };
        return;
      }
      // empty space: begin a vertex marquee (a plain click with no drag still deselects on
      // up). Dragging from here box-selects the selected shape's vertices — never conflicts
      // with shape-move (that starts on the body) or vertex drag (that starts on a dot).
      beginMarquee();
      return;
    }

    // explicit tools operate on the current selection only, wherever you grab;
    // locked layers are inert on canvas (inspector still edits them)
    const target = doc.shapes.find((s) => s.id === state.selectedId) ?? null;
    if (!target || target.locked) return;
    if (effective === "move") {
      dragRef.current = { kind: "move", id: target.id, startCanvas: p, startPos: target.transform.pos };
    } else if (effective === "rotate") {
      dragRef.current = {
        kind: "rotate",
        id: target.id,
        startCanvas: p,
        startRotation: target.transform.rotation,
        pivot: target.transform.pos,
      };
    } else {
      dragRef.current = {
        kind: "scale",
        id: target.id,
        startCanvas: p,
        startScale: { ...target.transform.scale },
        pivot: target.transform.pos,
        rotation: target.transform.rotation,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const cp = toCanvasPoint(e);
    setCursor(v2(Math.floor(cp.x), Math.floor(cp.y)));
    if (tool === "pen") setPenCursor(penDraft ? cp : null);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      setViewport((vp) => ({ ...vp, panX: vp.panX + e.clientX - drag.lastX, panY: vp.panY + e.clientY - drag.lastY }));
      dragRef.current = { ...drag, lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (drag.kind === "marquee") {
      // only a control-point shape can be box-selected; otherwise the empty drag is inert
      const sel = doc.shapes.find((s) => s.id === state.selectedId);
      if (!sel || getShapeType(sel.typeId).controlPoints.kind === "none") return;
      const moved = drag.moved || Math.hypot(cp.x - drag.startCanvas.x, cp.y - drag.startCanvas.y) * viewport.zoom > 3;
      dragRef.current = { ...drag, current: cp, moved };
      if (!moved) return;
      setMarquee({ a: drag.startCanvas, b: cp });
      const canvasPts = sel.controlPoints.map((q) => fromLocal(sel.transform, q));
      const inBox = pointsInBox(canvasPts, drag.startCanvas, cp);
      setSelVerts(drag.additive ? Array.from(new Set([...drag.base, ...inBox])) : inBox);
      return;
    }
    if (drag.kind === "move") {
      let dx = cp.x - drag.startCanvas.x;
      let dy = cp.y - drag.startCanvas.y;
      if (e.shiftKey) ({ dx, dy } = constrainAxis(dx, dy)); // godot move-mode axis lock
      store.update(
        (d) =>
          updateShape(d, drag.id, (s) => ({
            ...s,
            transform: { ...s.transform, pos: { ...s.transform.pos, x: drag.startPos.x + dx, y: drag.startPos.y + dy } },
          })),
        { coalesce: `move:${drag.id}` },
      );
      return;
    }
    if (drag.kind === "rotate") {
      let rot = rotationFromDrag(drag.pivot, drag.startCanvas, cp, drag.startRotation);
      if (e.shiftKey) rot = snapAngle(rot, ROTATE_SNAP); // godot snaps via ctrl; ctrl is our override key
      store.update((d) => updateShape(d, drag.id, (s) => ({ ...s, transform: { ...s.transform, rotation: rot } })), {
        coalesce: `rot:${drag.id}`,
      });
      return;
    }
    // scale: per-axis local ratio (godot DRAG_SCALE_BOTH); shift = uniform
    const sc = axisScaleFromDrag(drag.pivot, drag.rotation, drag.startCanvas, cp, drag.startScale, e.shiftKey);
    store.update((d) => updateShape(d, drag.id, (s) => ({ ...s, transform: { ...s.transform, scale: sc } })), {
      coalesce: `scale:${drag.id}`,
    });
  };

  const endDrag = (): void => {
    const drag = dragRef.current;
    if (drag?.kind === "marquee" && !drag.moved && !drag.additive) {
      // plain click (no box): vertex tool just clears the vertex selection (keeps the shape);
      // select tool deselects the shape entirely
      setSelVerts([]);
      if (tool !== "vertex") store.select(null);
    }
    setMarquee(null);
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

  const toolCursor =
    tool === "move" ? "cursor-move" : tool === "rotate" || tool === "scale" ? "cursor-crosshair" : "";

  return (
    <div
      ref={hostRef}
      className={`absolute inset-0 overflow-hidden ${toolCursor}`}
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
              Open a diffuse image (or an existing project) from the File menu to start.
            </p>
          </div>
        </div>
      ) : null}
      {diffuseBytes ? <Surfaces doc={doc} viewport={viewport} /> : null}
      {penDraft && penDraft.length > 0
        ? (() => {
            const sp = penDraft.map((v) => canvasToScreen(viewport, v));
            const cur = penCursor ? canvasToScreen(viewport, penCursor) : sp[sp.length - 1]!;
            const first = sp[0]!;
            const closing = penDraft.length >= 3 && Math.hypot(cur.x - first.x, cur.y - first.y) < 10;
            return (
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                <polyline
                  points={[...sp, cur].map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                {sp.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={i === 0 && closing ? 6 : 4}
                    fill={i === 0 && closing ? "var(--color-accent)" : "#ffffff"}
                    stroke="var(--color-accent)"
                    strokeWidth={1.5}
                  />
                ))}
              </svg>
            );
          })()
        : null}
      <Gizmos
        doc={doc}
        selectedId={state.selectedId}
        viewport={viewport}
        store={store}
        tool={tool}
        selVerts={selVerts}
        setSelVerts={setSelVerts}
      />
      {marquee ? (
        (() => {
          const a = canvasToScreen(viewport, marquee.a);
          const b = canvasToScreen(viewport, marquee.b);
          return (
            <div
              className="pointer-events-none absolute border border-accent bg-accent/15"
              style={{
                left: Math.min(a.x, b.x),
                top: Math.min(a.y, b.y),
                width: Math.abs(a.x - b.x),
                height: Math.abs(a.y - b.y),
              }}
            />
          );
        })()
      ) : null}
      {diffuseBytes && view.mode === "lit" ? (
        <div
          className="absolute top-3 right-3 flex flex-col items-center gap-1 border border-border bg-surface2/90 p-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <LightPad lightDir={view.lightDir} onChange={onLightChange} radius={34} />
          <span className="text-sm uppercase tracking-[var(--tracking-tight)] text-fg-mid">light</span>
        </div>
      ) : null}
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
