import { CubeRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import type { DocumentStore, EditorState } from "../document/store";
import { addShape, updateShape } from "../document/docOps";
import { getShapeType } from "../field/registry";
import { normalSigns } from "../document/schema";
import { DEFAULT_ORBIT, Orbit, orbitMvp, orbitTarget, projectToScreen } from "../field/gpu/preview3d";
import { v2, Vec2 } from "../field/vec";
import { Gizmos } from "./Gizmos";
import { LightPad } from "./LightPad";
import { usePersistentState } from "./persist";
import { axisScaleFromDrag, constrainAxis, pickShape, rotationFromDrag, snapAngle } from "./picking";
import { PreviewRenderer } from "./preview";
import { Dock3D, DOCKED_SIZE, FloatGeom, HEADER_H, Preview3DPanel } from "./Preview3DPanel";
import { fitViewport, screenToCanvas, Viewport, zoomAt } from "./viewport";
import type { ToolMode } from "./tools";
import type { ViewState } from "./App";

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 8;

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
    };

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
  const spaceRef = useRef(false);
  const [show3d, setShow3d] = usePersistentState("panel:3d", false);
  const [dock3d, setDock3d] = usePersistentState<Dock3D>("panel:3d:dock", "docked");
  const [geom3d, setGeom3d] = usePersistentState<FloatGeom>("panel:3d:geom", { x: 80, y: 80, w: 420, h: 420 });
  const [orbit, setOrbit] = useState<Orbit>({ ...DEFAULT_ORBIT });
  const canvas3dRef = useRef<HTMLCanvasElement>(null);

  // 3D camera gestures. Document-level CAPTURE listeners for the gesture lifetime: element
  // pointer-capture proved unreliable on the presenting WebGPU canvas, and bubble-phase
  // listeners die at the panel's stopPropagation (react dispatches from #root, killing the
  // native bubble before it reaches document) — capture fires first, immune to both.
  const begin3dGesture = (e: React.PointerEvent, step: (dx: number, dy: number) => void): void => {
    e.stopPropagation();
    e.preventDefault();
    const onMove = (ev: PointerEvent): void => step(ev.movementX, ev.movementY);
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
  };

  // left = orbit; middle or shift+left = pan the look-at target across the screen plane
  const on3dCanvasDown = (e: React.PointerEvent): void => {
    const cssW = dock3d === "float" ? geom3d.w : DOCKED_SIZE;
    if (e.button === 1 || e.shiftKey) {
      begin3dGesture(e, (dx, dy) =>
        setOrbit((o) => ({ ...o, panX: o.panX + (dx / cssW) * o.dist, panY: o.panY - (dy / cssW) * o.dist })),
      );
    } else if (e.button === 0) {
      begin3dGesture(e, (dx, dy) =>
        setOrbit((o) => ({
          ...o,
          yaw: o.yaw - dx * 0.01,
          pitch: Math.min(1.45, Math.max(0.08, o.pitch + dy * 0.01)),
        })),
      );
    }
  };

  const zoom3dBy = (factor: number): void =>
    setOrbit((o) => ({ ...o, dist: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, o.dist * factor)) }));

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

  // space = temporary pan (godot-style); tracked outside react state for drag handlers
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

  // demo/capture hook: ?p3d=1 opens the 3D panel
  useEffect(() => {
    if (new URLSearchParams(location.search).has("p3d")) setShow3d(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3D panel canvas CSS size depends on dock mode / float geometry
  const canvas3dW = dock3d === "float" ? geom3d.w : DOCKED_SIZE;
  const canvas3dH = dock3d === "float" ? geom3d.h - HEADER_H : DOCKED_SIZE;

  // project the orbit/pan focal point to the 3D canvas for the crosshair overlay
  const focal3d = projectToScreen(
    orbitMvp(orbit, doc.source.width, doc.source.height, canvas3dW / Math.max(1, canvas3dH)),
    orbitTarget(orbit, doc.source.width, doc.source.height),
    canvas3dW,
    canvas3dH,
  );

  // attach the 3D inspection canvas while the panel is open; resize backing store to match
  useEffect(() => {
    const r = rendererRef.current;
    const canvas = canvas3dRef.current;
    if (!ready || !r || !show3d || !canvas) return;
    canvas.width = Math.max(1, Math.floor(canvas3dW * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(canvas3dH * devicePixelRatio));
    r.attach3D(canvas);
    return () => r.attach3D(null);
  }, [ready, show3d, diffuseBytes, canvas3dW, canvas3dH]);

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
      orbit3d: show3d ? orbit : null,
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

    if (effective === "select") {
      // only the pointer picks by clicking; other tools select via the layer panel
      const hit = pickShape(doc.shapes, p);
      store.select(hit?.id ?? null);
      if (hit) dragRef.current = { kind: "move", id: hit.id, startCanvas: p, startPos: hit.transform.pos };
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
      <Gizmos doc={doc} selectedId={state.selectedId} viewport={viewport} store={store} tool={tool} />
      {diffuseBytes && view.mode === "lit" ? (
        <div className="absolute top-3 right-3 flex flex-col items-center gap-1 border border-border bg-surface2/90 p-2">
          <LightPad lightDir={view.lightDir} onChange={onLightChange} radius={34} />
          <span className="text-sm uppercase tracking-[var(--tracking-tight)] text-fg-mid">light</span>
        </div>
      ) : null}
      {diffuseBytes && show3d ? (
        <Preview3DPanel
          canvasRef={canvas3dRef}
          canvasW={canvas3dW}
          canvasH={canvas3dH}
          mode={dock3d}
          geom={geom3d}
          setGeom={setGeom3d}
          setMode={setDock3d}
          onClose={() => setShow3d(false)}
          onCanvasDown={on3dCanvasDown}
          onWheel={(e) => zoom3dBy(e.deltaY < 0 ? 0.9 : 1.1)}
          zoomBy={zoom3dBy}
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
