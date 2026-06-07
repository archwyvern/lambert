import { CubeRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import type { DocumentStore, EditorState } from "../document/store";
import { addShape, updateShape } from "../document/docOps";
import { getShapeType } from "../field/registry";
import { fromLocal } from "../field/transform";
import { normalSigns } from "../document/schema";
import { v2, Vec2 } from "../field/vec";
import { Gizmos } from "./Gizmos";
import { LightPad } from "./LightPad";
import { usePersistentState } from "./persist";
import { axisScaleFromDrag, constrainAxis, pickShape, pointsInBox, rotationFromDrag, snapAngle } from "./picking";
import { PreviewRenderer } from "./preview";
import { Dock3D, DOCKED_SIZE, HEADER3D, Preview3DPanel } from "./Preview3DPanel";
import { use3DCamera } from "./use3DCamera";
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
  onLightChange: (dir: [number, number, number]) => void;
}): React.JSX.Element {
  const { store, state, view, tool, diffuseBytes, onLightChange } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [selVerts, setSelVerts] = useState<number[]>([]);
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [show3d, setShow3d] = usePersistentState("panel:3d", false);
  const [dock3d, setDock3d] = usePersistentState<Dock3D>("panel:3d:dock", "docked");
  const [hostSize, setHostSize] = useState({ w: 1, h: 1 });
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const cam3d = use3DCamera();

  const doc = state.doc;
  const full = show3d && dock3d === "full";
  // refs so the global keydown handler reads live values without re-subscribing
  const fullRef = useRef(full);
  fullRef.current = full;

  // init renderer + canvas sizing
  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    const resize = (): void => {
      const r = host.getBoundingClientRect();
      setHostSize({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) });
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

  // space = toggle the full-editor 3D view on/off (off -> fullscreen, fullscreen -> hidden).
  // The docked mini-view stays reachable via the cube button + the header maximize toggle.
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code !== "Space" || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      if (fullRef.current) {
        setShow3d(false);
      } else {
        setShow3d(true);
        setDock3d("full");
      }
    };
    window.addEventListener("keydown", down);
    return () => {
      window.removeEventListener("keydown", down);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // vertex selection is per-shape: clear it whenever the selected shape changes
  useEffect(() => setSelVerts([]), [state.selectedId]);

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

  // demo/capture hook: ?p3d opens the 3D view (docked, or filling the editor with &full3d)
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.has("p3d")) {
      setShow3d(true);
      setDock3d(q.has("full3d") ? "full" : "docked");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3D canvas CSS size: docked = fixed mini-view; full = fills the editor area
  const c3w = full ? hostSize.w : DOCKED_SIZE;
  const c3h = full ? hostSize.h - HEADER3D : DOCKED_SIZE;
  const focal3d = cam3d.focal(doc.source.width, doc.source.height, c3w, c3h);

  // attach the embedded 3D canvas while open; resize the backing store to the current mode
  useEffect(() => {
    const r = rendererRef.current;
    const canvas = canvas3dRef.current;
    if (!ready || !r || !show3d || !canvas) return;
    canvas.width = Math.max(1, Math.floor(c3w * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(c3h * devicePixelRatio));
    r.attach3D(canvas);
    return () => r.attach3D(null);
  }, [ready, show3d, diffuseBytes, c3w, c3h]);

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
      orbit3d: show3d ? cam3d.orbit : null,
    });
  });

  const toCanvasPoint = (e: React.PointerEvent): Vec2 => {
    const rect = hostRef.current!.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.button === 1) {
      dragRef.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const p = toCanvasPoint(e);

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
      {diffuseBytes && show3d ? (
        <Preview3DPanel
          mode={dock3d}
          canvasRef={canvas3dRef}
          canvasW={c3w}
          canvasH={c3h}
          onToggleSize={() => setDock3d(full ? "docked" : "full")}
          onClose={() => setShow3d(false)}
          onCanvasDown={cam3d.onCanvasDown(doc.source.width, doc.source.height, c3w)}
          onWheel={cam3d.onWheel(doc.source.width, doc.source.height)}
          zoomBy={cam3d.zoomBy}
          focal={focal3d}
        />
      ) : null}
      {diffuseBytes && !show3d ? (
        <button
          title="3D preview"
          className="absolute right-3 bottom-8 flex h-[26px] w-[30px] items-center justify-center border border-border bg-surface2/90 text-fg-mid hover:bg-hover hover:text-fg"
          onClick={() => setShow3d(true)}
        >
          <CubeRegular style={{ fontSize: 15 }} />
        </button>
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
