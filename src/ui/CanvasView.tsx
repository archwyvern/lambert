import { useEffect, useRef, useState } from "react";
import type { DocumentStore, EditorState } from "../document/store";
import { addInstance, duplicateObject, moveObjectTo, removeObject, updateObject } from "../document/docOps";
import { clearGuides, removeGuide } from "../document/canvasOps";
import { bezierAnchor } from "../field/bezier";
import { createMask } from "../field/maskOps";
import { flattenLayers } from "../field/flatten";
import { duplicateNode, findNode, nodeFrames, nodeWorldAffine, updateNode } from "../document/layerOps";
import { affineApply, affineInvert } from "../field/affine";
import { isGroup, isObject } from "../field/types";
import { insertVertex } from "../field/controlPoints";
import { getObjectType, ObjectTypeId } from "../field/registry";
import { editSnap } from "./snapPoint";
import { fromLocal, toLocal } from "../field/transform";
import type { ObjectInstance } from "../field/types";
import { normalSigns, type NormalDirs } from "../document/schema";
import { Vector2, Vector3 } from "@carapace/primitives";
import { EmptyState, ShortcutGuide, SpinSlider } from "@carapace/shell";
import { v2 } from "../field/vec";
import { ContextMenu, type MenuEntry } from "./kit";
import { Gizmos } from "./Gizmos";
import { LightPad } from "./LightPad";
import { axisScaleFromDrag, constrainAxis, pickObject, pointsInBox, rotationFromDrag, ROTATE_SNAP, snapAngle } from "./picking";
import { PreviewRenderer } from "./preview";
import { RULER, Rulers } from "./Rulers";
import { guide2D, type GuideContext } from "./keymap";
import type { Orbit } from "../field/gpu/preview3d";
import { canvasToScreen, screenToCanvas, Viewport, zoomAt } from "./viewport";
import { useCanvasViewport } from "./useCanvasViewport";
import { useGuideDrag } from "./useGuideDrag";
import { PEN_CLOSE_PX, usePenDraft } from "./usePenDraft";
import { localBounds } from "./objectBounds";
import { CANCEL_DRAG_EVENT } from "./usePointerDrag";
import type { Placing, ToolMode } from "./tools";
import type { ViewState } from "./App";

type Drag =
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "measure" } // endpoints live in the `measure` state (they render after release too)
  // moved: crossed the click-vs-drag threshold (until then the drag writes nothing). dupOnMove: this
  // is an Alt-drag, so the first real move clones the object and the copy is what gets dragged.
  // group: EVERY dragged node's start pos + its parent's inverse linear (world delta -> that node's
  // local delta) — a single-object drag is a one-entry group, so nested objects under rotated/scaled
  // parent groups move correctly too (QC-INT-1).
  | {
      kind: "move";
      id: string;
      startCanvas: Vector2;
      /** The grabbed node's WORLD position at drag start — what grid/guide snapping targets. */
      startWorld: Vector2;
      moved?: boolean;
      dupOnMove?: boolean;
      group: { id: string; startX: number; startY: number; il: { a: number; b: number; c: number; d: number } }[];
    }
  // pivot is the node's WORLD position; detSign flips the spin under a mirrored parent (negative det)
  | { kind: "rotate"; id: string; startCanvas: Vector2; startRotation: number; pivot: Vector2; detSign: number; moved?: boolean }
  | {
      kind: "scale";
      id: string;
      startCanvas: Vector2;
      startScale: Vector3;
      /** WORLD position of the node (the scale pivot). */
      pivot: Vector2;
      /** WORLD-frame angle of the node's local x-axis (composes the parent's rotation). */
      rotation: number;
      moved?: boolean;
    }
  | {
      kind: "marquee";
      startCanvas: Vector2;
      current: Vector2;
      additive: boolean;
      // objects: box-select object footprints -> setSelection (select tool, empty-canvas drag). else: a
      // vertex marquee over the selected control-point object (vertex tool). base/baseIds are the additive
      // start set for each mode.
      objects: boolean;
      base: number[];
      baseIds: string[];
      moved: boolean;
    };

export function CanvasView(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  tool: ToolMode;
  diffuseBytes: Uint8Array | null;
  /** Palette id -> fresh instance (built-in identity tiles + user-saved presets) — see App. */
  resolvePaletteObject: (presetId: string, pos: Vector2) => ObjectInstance;
  selVerts: number[];
  setSelVerts: (v: number[] | ((p: number[]) => number[])) => void;
  /** Inspector "select this mask": routed through to MaskGizmo, which selects all its anchors. */
  maskFocus: { nodeId: string; maskId: string; seq: number } | null;
  onLightChange: (dir: [number, number, number]) => void;
  onEnergyChange: (energy: number) => void;
  canvas3dRef: React.RefObject<HTMLCanvasElement | null>;
  orbit3d: Orbit;
  /** Project normal-channel convention (project.lambert), for the normal-view encode. */
  normalDirs: NormalDirs;
  /** 3D preview is occupying the big slot (this 2D view is hidden behind it) — hide the 2D guide. */
  swapped: boolean;
  /** Per-tab viewport persistence: the tab's stable id, its saved pan/zoom (undefined = not yet fitted),
   *  and a reporter so App can stash it per-tab (survives tab switch + reload). */
  tabId: string;
  savedViewport: Viewport | undefined;
  onViewportChange: (vp: Viewport) => void;
  /** Switch the active tool (double-click a control-point object to jump into vertex editing). */
  setTool: (t: ToolMode) => void;
  /** Global ½px grid snap (positions, vertices, polygon + curve points). */
  snap: boolean;
  /** Show the top/left rulers (insets the canvas area). */
  rulers: boolean;
}): React.JSX.Element {
  const { store, state, view, tool, diffuseBytes, selVerts, setSelVerts, onLightChange, onEnergyChange, canvas3dRef, orbit3d, normalDirs, swapped } =
    props;
  const { tabId, savedViewport, onViewportChange, setTool, snap, rulers, resolvePaletteObject, maskFocus } = props;
  const inset = rulers ? RULER : 0;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 }); // inset canvas-area size, for the rulers
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState<Vector2 | null>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const stateRef = useRef(state); // current selection/layers for window-level handlers (zoom-to-selection)
  stateRef.current = state;
  // pan/zoom + everything that drives it from outside a drag (seed/persist, menu zoom, wheel) — QC-CARRY-1
  const { viewport, setViewport } = useCanvasViewport({
    hostRef,
    tabId,
    docW: state.doc.source.width,
    docH: state.doc.source.height,
    savedViewport,
    onViewportChange,
    stateRef,
  });
  const viewportRef = useRef(viewport); // for window-level drag closures (guide drag)
  viewportRef.current = viewport;
  const dragRef = useRef<Drag | null>(null);
  // the object a press would grab right now (select tool, idle) — drives the grab cursor + a faint
  // footprint outline so stacked scenes show the pick target before you commit to the click (QC-INT-14)
  const [hoverId, setHoverId] = useState<string | null>(null);
  // the measure tool's two endpoints (canvas space, snapped) — persists after release so the readout can
  // be studied; cleared on the next press, tool switch, or Esc
  const [measure, setMeasure] = useState<{ a: Vector2; b: Vector2 } | null>(null);
  // hold-Space = temporary pan (any tool): left-drag pans while held (Photoshop/Figma). App swallows the
  // keydown (no page scroll); we track held-state here. Cleared on keyup AND window blur (a missed keyup
  // — e.g. Alt-Tab while held — must not leave pan stuck on).
  const [spacePan, setSpacePan] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const tgt = e.target;
      if (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement || tgt instanceof HTMLSelectElement) return;
      if (e.code === "Space" && !e.repeat) setSpacePan(true);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === "Space") setSpacePan(false);
    };
    const blur = (): void => setSpacePan(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  // a guide being dragged out of a ruler (not yet committed); `over` = cursor is over the canvas area
  // ruler-guide creation/drag (draft line, live move, drop-to-delete) — QC-CARRY-1 extraction
  const { guideDraft, guideDrag, startGuideCreate, startGuideMove } = useGuideDrag({ hostRef, viewportRef, hostSize, store, snap });
  const [guideMenu, setGuideMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Vector2; b: Vector2 } | null>(null);
  const [bodyMenu, setBodyMenu] = useState<{ x: number; y: number; id: string } | null>(null); // right-click an object
  // click-to-place (pen-extend) + mask-pen draft state — QC-CARRY-1 extraction
  const { placing, setPlacing, placeCursor, setPlaceCursor, penPts, setPenPts } = usePenDraft({
    tool,
    selectedId: state.selectedId,
    tabId,
    cursorRef,
  });

  const doc = state.doc;
  // find an object leaf by id (groups return undefined — the canvas edits objects; groups via the gizmo)
  const findObject = (sid: string | null): ObjectInstance | undefined => {
    if (!sid) return undefined;
    const n = findNode(doc.layers, sid);
    return n && isObject(n) ? n : undefined;
  };

  // grid + guide snap for any world point being edited (no-op when both toggles are off)
  const snapPt = editSnap(doc.canvas, snap, viewport.zoom);

  // init renderer + canvas sizing
  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    // persists across resize() calls (same closure) so we can shift the viewport by the size delta
    let prevSize: { w: number; h: number } | null = null;
    const resize = (): void => {
      const r = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(r.height * devicePixelRatio));
      setHostSize({ w: r.width, h: r.height });
      // Keep the view CENTRE pinned to the same world point when the canvas area grows/shrinks (window
      // maximize/restore/drag): pan is an absolute screen-px offset, so without this the content stays
      // pinned top-left and slides off-centre. Skip the initial 0->size (the seed/fit effect handles
      // first layout).
      if (prevSize && (prevSize.w !== r.width || prevSize.h !== r.height)) {
        const dw = r.width - prevSize.w;
        const dh = r.height - prevSize.h;
        setViewport((vp) => ({ ...vp, panX: vp.panX + dw / 2, panY: vp.panY + dh / 2 }));
      }
      prevSize = { w: r.width, h: r.height };
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

  // attach the 3D canvas (owned by App's Preview3D) to the renderer; Preview3D sizes its own
  // backing store and the renderer reads canvas.width/height each frame
  useEffect(() => {
    const r = rendererRef.current;
    const canvas = canvas3dRef.current;
    if (!ready || !r || !canvas) return;
    r.attach3D(canvas);
    return () => r.attach3D(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // upload diffuse when it changes. setDiffuse throws on a dims mismatch (the decoded diffuse ≠ the
  // doc's source dims — e.g. the .lmb's recorded dims changed on disk since the diffuse was cached).
  // Catch it: an uncaught throw here would escape the effect and, with no error boundary, unmount the
  // whole app to a blank screen instead of showing an error.
  useEffect(() => {
    if (!ready || !rendererRef.current || !diffuseBytes) return;
    try {
      rendererRef.current.setDiffuse(diffuseBytes, doc.source.width, doc.source.height);
    } catch (err) {
      setGpuError(err instanceof Error ? err.message : String(err));
    }
  }, [ready, diffuseBytes, doc.source.width, doc.source.height]);

  // render on any relevant change (rAF-coalesced inside the renderer)
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !diffuseBytes || !ready) return;
    r.requestRender(doc.source.width, doc.source.height, {
      layers: doc.layers,
      viewport,
      mode: view.mode,
      opacity: view.opacity,
      lightDir: view.lightDir,
      lightEnergy: view.lightEnergy,
      normalSigns: normalSigns(normalDirs),
      orbit3d,
    });
  });

  const toCanvasPoint = (e: React.PointerEvent): Vector2 => {
    const rect = hostRef.current!.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };

  // drop a placed point at the cursor and chain (stay in placing mode for the next click)
  const commitPlace = (canvasPt: Vector2): void => {
    if (!placing) return;
    const object = findObject(placing.objectId);
    if (!object) return setPlacing(null);
    const local = toLocal(object.transform, snapPt(canvasPt));
    if (placing.kind === "cable-end") {
      store.update((d) =>
        updateObject(d, placing.objectId, (s) =>
          s.bezier
            ? { ...s, bezier: placing.end === "end" ? [...s.bezier, bezierAnchor(local)] : [bezierAnchor(local), ...s.bezier] }
            : s,
        ),
      );
      store.endGesture(); // the end stays the end — the rubber-band re-reads the new anchor next render
    } else {
      store.update((d) =>
        updateObject(d, placing.objectId, (s) => ({ ...s, controlPoints: insertVertex(s.controlPoints, placing.afterIndex, local) })),
      );
      store.endGesture();
      setSelVerts([placing.afterIndex + 1]);
      setPlacing({ ...placing, afterIndex: placing.afterIndex + 1 }); // chain from the point just placed
    }
  };

  // close the pen draft into a keep mask (follow=true: stored in the target's local frame). Targets
  // the selected node — an object OR a group — converting through its full world affine (so a mask on a
  // nested object or a group lands in the right frame).
  const commitMask = (pts: Vector2[]): void => {
    const target = state.selectedId ? findNode(doc.layers, state.selectedId) : null;
    if (!target || pts.length < 3) return setPenPts([]);
    const aff = nodeWorldAffine(doc.layers, target.id);
    if (!aff) return setPenPts([]);
    const inv = affineInvert(aff);
    const localPts = pts.map((p) => affineApply(inv, snapPt(p)));
    const mask = createMask(localPts, true);
    store.update((d) => ({ ...d, layers: updateNode(d.layers, target.id, (n) => ({ ...n, masks: [...(n.masks ?? []), mask] })) }));
    store.endGesture();
    setPenPts([]);
    setTool("select");
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (tool === "pen") {
      if (e.button === 2) return setPenPts([]); // right-click abandons the draft
      if (e.button === 0) {
        e.stopPropagation();
        if (!state.selectedId) return; // pen needs an owner layer (Inspector "+ Add Mask" guarantees one)
        const rect = hostRef.current!.getBoundingClientRect();
        if (penPts.length >= 3) {
          const first = canvasToScreen(viewport, penPts[0]!);
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          if (Math.hypot(sx - first.x, sy - first.y) <= PEN_CLOSE_PX) return commitMask(penPts);
        }
        // snap the placed point immediately when global snap is on, so the ghost + close hotspot match
        // exactly where the committed mask lands (no jump on close).
        const cp = toCanvasPoint(e);
        setPenPts((pts) => [...pts, snapPt(cp)]);
        return;
      }
      // middle button falls through to the pan handler below (pan while drawing a mask)
    }
    if (placing) {
      if (e.button === 0) {
        e.stopPropagation();
        commitPlace(toCanvasPoint(e));
        return;
      }
      if (e.button === 2) {
        setPlacing(null);
        return;
      }
      // middle button falls through to pan
    }
    // right-click never starts a host drag — bail BEFORE capturing the pointer. A captured pointer
    // makes Chromium retarget the contextmenu event to the host, so it would always show the layer
    // menu instead of the vertex/anchor menu the gizmo handle under the cursor wants to open.
    if (e.button !== 0 && e.button !== 1) return;
    // capture on the host (which owns move/up), not e.target — so a drag keeps tracking and still
    // ends when the cursor leaves the canvas or releases off-window. Capture is an enhancement:
    // it can throw for exotic/synthetic pointers (NotFoundError), and the drag still works without it.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (synthetic events / pen edge cases) */
    }
    if (e.button === 1 || spacePan) {
      // middle-drag or hold-Space + left-drag both pan (Space is the trackpad/pen-tablet path)
      dragRef.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
      return;
    }
    const p = toCanvasPoint(e);

    const beginMarquee = (objects: boolean): void => {
      dragRef.current = {
        kind: "marquee",
        startCanvas: p,
        current: p,
        additive: e.shiftKey,
        objects,
        base: !objects && e.shiftKey ? selVerts : [],
        baseIds: objects && e.shiftKey ? state.selectedIds : [],
        moved: false,
      };
    };

    // start a body move-drag. Every dragged node gets its start pos + its parent's inverse linear, so
    // the shared WORLD delta converts into each node's own local frame (correct under nested groups).
    // A grab on a multi-selection member drags the whole selection; dup = Alt-drag a single copy. The
    // includes() guard also covers the caller re-selecting a non-member hit (this closure's selection
    // array is the pre-select snapshot).
    const beginMove = (hit: ObjectInstance, dup: boolean): void => {
      const ids = !dup && state.selectedIds.length > 1 && state.selectedIds.includes(hit.id) ? state.selectedIds : [hit.id];
      const group = ids
        .map((sid) => {
          const node = findNode(doc.layers, sid);
          if (!node) return null;
          const inv = nodeFrames(doc.layers, sid).invParent;
          return { id: sid, startX: node.transform.pos.x, startY: node.transform.pos.y, il: { a: inv.a, b: inv.b, c: inv.c, d: inv.d } };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null);
      dragRef.current = {
        kind: "move",
        id: hit.id,
        startCanvas: p,
        startWorld: affineApply(nodeFrames(doc.layers, hit.id).parentAffine, v2(hit.transform.pos.x, hit.transform.pos.y)),
        dupOnMove: dup || undefined,
        group,
      };
    };

    if (tool === "measure") {
      const a = snapPt(p);
      setMeasure({ a, b: a });
      dragRef.current = { kind: "measure" };
      return;
    }

    if (tool === "vertex") {
      // vertex tool: the body never grabs drags. Clicking a different object picks it for
      // editing; otherwise any drag is a marquee (works over the body too — solves interior
      // verts). Clicking a vertex dot is handled by the gizmo (it stops propagation).
      const hit = pickObject(flattenLayers(doc.layers), p);
      if (hit && hit.id !== state.selectedId) {
        store.select(hit.id);
        return;
      }
      beginMarquee(false); // vertex marquee over the selected control-point object
      return;
    }

    if (tool === "select") {
      // only the pointer picks by clicking; other tools select via the layer panel
      const hit = pickObject(flattenLayers(doc.layers), p);
      if (hit) {
        // pressing the body (anything that isn't a vertex dot — those stop propagation and never
        // reach here) drops the vertex selection. Clicking a DIFFERENT object already clears it via
        // the selectedId effect; this also covers re-pressing the already-selected object's body.
        setSelVerts([]);
        if (e.shiftKey) {
          store.toggleSelect(hit.id); // add/remove from the multi-selection; no drag
          return;
        }
        if (e.altKey && !hit.locked) {
          // Photoshop convention: Alt-drag drops a copy and drags it (original stays). Defer the clone
          // to the first real move so a plain Alt-click doesn't silently stack an invisible duplicate.
          store.select(hit.id);
          beginMove(hit, true);
          return;
        }
        // keep an existing multi-selection when grabbing one of its members (drag moves all); else pick it
        if (!state.selectedIds.includes(hit.id)) store.select(hit.id);
        beginMove(hit, false);
        return;
      }
      // empty space in the select tool: drag box-selects OBJECTS (footprint AABB intersects the box;
      // Shift adds to the current selection). A plain click with no drag keeps the selection — clearing
      // it is ESC's job (App keymap), not an empty click.
      beginMarquee(true);
      return;
    }

    // explicit tools operate on the current selection only, wherever you grab;
    // locked layers are inert on canvas (inspector still edits them)
    const target = findObject(state.selectedId) ?? null;
    if (!target || target.locked) return;
    if (tool === "move") {
      beginMove(target, false); // same world-delta machinery as a body drag (multi-selection included)
    } else if (tool === "rotate") {
      const fr = nodeFrames(doc.layers, target.id);
      const det = fr.parentAffine.a * fr.parentAffine.d - fr.parentAffine.b * fr.parentAffine.c;
      dragRef.current = {
        kind: "rotate",
        id: target.id,
        startCanvas: p,
        startRotation: target.transform.rotation,
        // pivot in WORLD space (the pos is parent-local — for a nested object the two differ)
        pivot: affineApply(fr.parentAffine, v2(target.transform.pos.x, target.transform.pos.y)),
        detSign: det < 0 ? -1 : 1,
      };
    } else {
      const fr = nodeFrames(doc.layers, target.id);
      const cr = Math.cos(target.transform.rotation);
      const sr = Math.sin(target.transform.rotation);
      const P = fr.parentAffine;
      dragRef.current = {
        kind: "scale",
        id: target.id,
        startCanvas: p,
        startScale: target.transform.scale,
        pivot: affineApply(P, v2(target.transform.pos.x, target.transform.pos.y)),
        // world-frame angle of the local x-axis (exact under uniform parent scale)
        rotation: Math.atan2(P.c * cr + P.d * sr, P.a * cr + P.b * sr),
      };
    }
  };

  // every unlocked object whose WORLD footprint AABB intersects the marquee box (a..b, canvas space).
  // localBounds is transform-independent (params/points), so nodeWorldAffine gives the correct world box
  // even for nested objects.
  const objectsInBox = (a: Vector2, b: Vector2): string[] => {
    const lo = v2(Math.min(a.x, b.x), Math.min(a.y, b.y));
    const hi = v2(Math.max(a.x, b.x), Math.max(a.y, b.y));
    const out: string[] = [];
    for (const r of flattenLayers(doc.layers)) {
      const obj = r.object;
      if (obj.locked) continue;
      const aff = nodeWorldAffine(doc.layers, obj.id);
      if (!aff) continue;
      const lb = localBounds(obj);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of [v2(lb.min.x, lb.min.y), v2(lb.max.x, lb.min.y), v2(lb.max.x, lb.max.y), v2(lb.min.x, lb.max.y)]) {
        const w = affineApply(aff, c);
        minX = Math.min(minX, w.x); minY = Math.min(minY, w.y);
        maxX = Math.max(maxX, w.x); maxY = Math.max(maxY, w.y);
      }
      if (maxX >= lo.x && minX <= hi.x && maxY >= lo.y && minY <= hi.y) out.push(obj.id);
    }
    return out;
  };

  /** Box-hit the selected object's editable points — Bézier ANCHORS take priority (they're the edit
   *  surface for path objects; baked ring points would be the wrong index space). Null = the object
   *  has no editable points. */
  const vertsInBox = (sel: ObjectInstance, a: Vector2, b: Vector2): number[] | null => {
    if (sel.bezier && sel.bezier.length > 0) {
      return pointsInBox(sel.bezier.map((an) => fromLocal(sel.transform, an.p)), a, b);
    }
    if (getObjectType(sel.typeId).controlPoints.kind !== "none") {
      return pointsInBox(sel.controlPoints.map((q) => fromLocal(sel.transform, q)), a, b);
    }
    return null;
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const cp = toCanvasPoint(e);
    setCursor(v2(Math.floor(cp.x), Math.floor(cp.y)));
    if (placing) setPlaceCursor(cp);
    const drag = dragRef.current;
    // hover-pick feedback: only while idle in the select tool (setState with an unchanged id is a
    // React bail-out, so this doesn't add re-renders on top of the cursor readout above)
    if (!drag && tool === "select" && !placing) {
      setHoverId(pickObject(flattenLayers(doc.layers), cp)?.id ?? null);
    } else if (hoverId !== null) {
      setHoverId(null);
    }
    if (!drag) return;
    if (drag.kind === "pan") {
      setViewport((vp) => ({ ...vp, panX: vp.panX + e.clientX - drag.lastX, panY: vp.panY + e.clientY - drag.lastY }));
      dragRef.current = { ...drag, lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (drag.kind === "measure") {
      const b = snapPt(cp);
      setMeasure((m) => (m ? { a: m.a, b } : m));
      return;
    }
    if (drag.kind === "marquee") {
      const moved = drag.moved || Math.hypot(cp.x - drag.startCanvas.x, cp.y - drag.startCanvas.y) * viewport.zoom > 3;
      dragRef.current = { ...drag, current: cp, moved };
      if (!moved) return;
      setMarquee({ a: drag.startCanvas, b: cp });
      if (drag.objects) {
        // MIXED marquee (select tool): if the box catches anchors/vertices of the SELECTED object,
        // select those (the object stays selected); otherwise box-select objects. Object selection
        // only applies live while NON-empty — the first 3px of a drag contains nothing, and clearing
        // there made the selection (gizmo + Layers highlight) blink off/on at drag start. The final
        // result, including "nothing -> deselect", applies on release (endDrag).
        const sel = findObject(state.selectedId);
        const vertHits = sel ? vertsInBox(sel, drag.startCanvas, cp) : null;
        if (vertHits && vertHits.length > 0) {
          setSelVerts(drag.additive ? Array.from(new Set([...drag.base, ...vertHits])) : vertHits);
          return;
        }
        if (selVerts.length > 0) setSelVerts([]); // box left the vertices: back to object mode
        const ids = objectsInBox(drag.startCanvas, cp);
        if (ids.length > 0) store.setSelection(drag.additive ? Array.from(new Set([...drag.baseIds, ...ids])) : ids);
        return;
      }
      // vertex box-select (vertex tool): pure vertex mode
      const sel = findObject(state.selectedId);
      const inBox = sel ? vertsInBox(sel, drag.startCanvas, cp) : null;
      if (inBox === null) return; // no editable vertices
      setSelVerts(drag.additive ? Array.from(new Set([...drag.base, ...inBox])) : inBox);
      return;
    }
    // click-vs-drag: a transform drag writes nothing (and doesn't dirty the doc) until the pointer
    // moves past a few px. Once moved it stays moved, so dragging back to the start still tracks. The
    // first crossing is also where a deferred Alt-drag clones the object and hands the drag to the copy.
    if (drag.kind === "move" || drag.kind === "rotate" || drag.kind === "scale") {
      if (!drag.moved) {
        if (Math.hypot(cp.x - drag.startCanvas.x, cp.y - drag.startCanvas.y) * viewport.zoom <= 3) return;
        drag.moved = true;
        if (drag.kind === "move" && drag.dupOnMove) {
          // duplicate IN PLACE (sibling at index+1, same group + z-neighbourhood) and hand the drag to
          // the copy. The old top-level `[...d.layers, copy]` append escaped the object's group and
          // forced it to the very top of the z-order — inconsistent with the context-menu Duplicate.
          let newId = drag.id;
          store.update((d) => {
            const r = duplicateNode(d.layers, drag.id);
            newId = r.newId;
            return { ...d, layers: r.layers };
          });
          if (newId !== drag.id) {
            store.select(newId);
            drag.id = newId;
            // the copy is in-place identical (same parent, same start pos) — retarget the group entry
            drag.group = [{ ...drag.group[0]!, id: newId }];
          }
          drag.dupOnMove = false;
        }
        dragRef.current = drag;
      }
    }
    if (drag.kind === "move") {
      let dx = cp.x - drag.startCanvas.x;
      let dy = cp.y - drag.startCanvas.y;
      if (e.shiftKey) ({ dx, dy } = constrainAxis(dx, dy)); // godot move-mode axis lock
      // snap the grabbed node's resulting WORLD position (grid + guides — so multi-move honors both,
      // QC-INT-4), then apply the ONE adjusted world delta to every dragged node through its parent's
      // inverse linear, so nesting under rotated/scaled groups stays correct (QC-INT-1).
      const target = snapPt(v2(drag.startWorld.x + dx, drag.startWorld.y + dy));
      const wdx = target.x - drag.startWorld.x;
      const wdy = target.y - drag.startWorld.y;
      store.update(
        (d) => {
          let layers = d.layers;
          for (const g of drag.group) {
            const ldx = g.il.a * wdx + g.il.b * wdy;
            const ldy = g.il.c * wdx + g.il.d * wdy;
            layers = updateNode(layers, g.id, (n) => ({
              ...n,
              transform: { ...n.transform, pos: n.transform.pos.withX(g.startX + ldx).withY(g.startY + ldy) },
            }));
          }
          return { ...d, layers };
        },
        { coalesce: `move:${drag.id}` },
      );
      return;
    }
    if (drag.kind === "rotate") {
      // world angle delta mapped into the local frame — a mirrored parent (negative det) flips the spin
      const delta = rotationFromDrag(drag.pivot, drag.startCanvas, cp, 0);
      let rot = drag.startRotation + delta * drag.detSign;
      if (e.shiftKey) rot = snapAngle(rot, ROTATE_SNAP); // godot snaps via ctrl; ctrl is our override key
      store.update((d) => updateObject(d, drag.id, (s) => ({ ...s, transform: { ...s.transform, rotation: rot } })), {
        coalesce: `rot:${drag.id}`,
      });
      return;
    }
    // scale: per-axis local ratio (godot DRAG_SCALE_BOTH); shift = uniform
    const sc = axisScaleFromDrag(drag.pivot, drag.rotation, drag.startCanvas, cp, drag.startScale, e.shiftKey);
    store.update((d) => updateObject(d, drag.id, (s) => ({ ...s, transform: { ...s.transform, scale: sc } })), {
      coalesce: `scale:${drag.id}`,
    });
  };

  const endDrag = (): void => {
    const drag = dragRef.current;
    if (drag?.kind === "marquee" && !drag.moved && !drag.additive) {
      setSelVerts([]);
      // select tool: a plain empty-canvas click deselects the object too (like Esc). The vertex tool
      // keeps the object selected — you're editing it; the click only clears the vertex selection.
      if (drag.objects) store.select(null);
    } else if (drag?.kind === "marquee" && drag.objects && drag.moved && !drag.additive) {
      // live updates skip the empty state (anti-blink), so a box released over NOTHING applies its
      // "deselect everything" result here instead
      const sel = findObject(state.selectedId);
      const vertHits = sel ? vertsInBox(sel, drag.startCanvas, drag.current) : null;
      if ((!vertHits || vertHits.length === 0) && objectsInBox(drag.startCanvas, drag.current).length === 0) {
        setSelVerts([]);
        store.select(null);
      }
    }
    setMarquee(null);
    dragRef.current = null;
    store.endGesture();
  };

  // Esc mid-drag: drop the in-flight canvas drag (move/rotate/scale/marquee/pan) so no further move
  // commits. The store reverts the partial edit (App's Esc calls store.cancelGesture); a later pointer-up
  // finds a null dragRef and no-ops.
  useEffect(() => {
    const cancel = (): void => {
      dragRef.current = null;
      setMarquee(null);
      setMeasure(null);
    };
    window.addEventListener(CANCEL_DRAG_EVENT, cancel);
    return () => window.removeEventListener(CANCEL_DRAG_EVENT, cancel);
  }, []);

  // a lingering measurement only makes sense inside the measure tool
  useEffect(() => {
    if (tool !== "measure") setMeasure(null);
  }, [tool]);

  const pointAt = (e: React.MouseEvent): Vector2 => {
    const rect = hostRef.current!.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };

  // right-click an object body for its verbs (vertex/edge/anchor menus are handled by the gizmo, which
  // stops propagation, so this only fires on the plain body or empty canvas)
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    if (placing) {
      setPlacing(null);
      return;
    }
    const hit = pickObject(flattenLayers(doc.layers), pointAt(e), true); // include locked: reach their Unlock item
    if (hit) {
      // keep an existing multi-selection when right-clicking one of its members (so the body menu can
      // multi-target Duplicate/Delete/reorder); otherwise select just this object
      if (!state.selectedIds.includes(hit.id)) store.select(hit.id);
      setBodyMenu({ x: e.clientX, y: e.clientY, id: hit.id });
    } else {
      setBodyMenu(null);
    }
  };

  // double-click a control-point object to jump straight into vertex editing (the universal gesture)
  const onDoubleClick = (e: React.MouseEvent): void => {
    const hit = pickObject(flattenLayers(doc.layers), pointAt(e));
    if (hit && getObjectType(hit.typeId).controlPoints.kind !== "none") {
      store.select(hit.id);
      setTool("vertex");
    }
  };

  const bodyMenuItems = (s: ObjectInstance): MenuEntry[] => {
    const items: MenuEntry[] = [];
    // act on the whole selection when the right-clicked object is part of a multi-selection (kept by
    // onContextMenu); otherwise just this one
    const targets = state.selectedIds.includes(s.id) && state.selectedIds.length > 1 ? state.selectedIds : [s.id];
    const many = targets.length > 1;
    if (!many && getObjectType(s.typeId).controlPoints.kind !== "none") {
      items.push({ label: "Edit Vertices", onClick: () => { store.select(s.id); setTool("vertex"); } });
      items.push("separator");
    }
    const each = (f: (d: typeof state.doc, id: string) => typeof state.doc): void =>
      store.commit((d) => targets.reduce((acc, id) => f(acc, id), d));
    items.push({ label: many ? `Duplicate ${targets.length}` : "Duplicate", hotkey: "Ctrl+D", onClick: () => each((d, id) => duplicateObject(d, id)) });
    items.push({ label: "Bring to Front", onClick: () => each((d, id) => moveObjectTo(d, id, Number.MAX_SAFE_INTEGER)) });
    items.push({ label: "Send to Back", onClick: () => each((d, id) => moveObjectTo(d, id, 0)) });
    items.push({ label: s.locked ? "Unlock" : "Lock", onClick: () => each((d, id) => updateObject(d, id, (sh) => ({ ...sh, locked: !s.locked }))) });
    items.push("separator");
    items.push({ label: many ? `Delete ${targets.length}` : "Delete", danger: true, hotkey: "⌫", onClick: () => each((d, id) => removeObject(d, id)) });
    return items;
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    if (!diffuseBytes) return; // no document: nothing to author against
    const presetId = e.dataTransfer.getData("application/x-lambert-object");
    if (!presetId) return;
    const rect = hostRef.current!.getBoundingClientRect();
    const p = screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
    store.update((d) => addInstance(d, resolvePaletteObject(presetId, p)));
    store.endGesture();
  };

  const toolCursor = spacePan
    ? "cursor-grab"
    : placing || tool === "pen" || tool === "measure"
    ? "cursor-crosshair"
    : tool === "move"
      ? "cursor-move"
      : tool === "rotate" || tool === "scale"
        ? "cursor-crosshair"
        : "";

  return (
    <div className="absolute inset-0 overflow-hidden">
      {rulers ? (
        <Rulers
          viewport={viewport}
          origin={doc.canvas.origin}
          areaW={hostSize.w}
          areaH={hostSize.h}
          onGuideDragStart={startGuideCreate}
        />
      ) : null}
      <div
        ref={hostRef}
        className={`absolute overflow-hidden ${toolCursor}`}
        style={{ top: inset, left: inset, right: 0, bottom: 0 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHoverId(null)}
        onContextMenu={onContextMenu}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
      {gpuError ? (
        <div className="absolute inset-0 bg-bg">
          <EmptyState status="error" title="Preview unavailable" message={gpuError} />
        </div>
      ) : !ready ? (
        <div className="absolute inset-0 bg-bg">
          <EmptyState status="loading" message="Initializing renderer…" />
        </div>
      ) : !diffuseBytes ? (
        <div className="absolute inset-0">
          <EmptyState
            status="info"
            title="No document"
            message="Open a diffuse image (or an existing project) from the File menu to start."
          />
        </div>
      ) : null}
      {/* guides: teal full-extent lines; when unlocked, a fat invisible hit-line drags / right-clicks each */}
      {diffuseBytes ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {doc.canvas.guides.map((g, i) => {
            const horiz = g.orient === "h";
            const s = canvasToScreen(viewport, horiz ? v2(0, g.at) : v2(g.at, 0));
            const line = horiz
              ? { x1: 0, y1: s.y, x2: "100%" as const, y2: s.y }
              : { x1: s.x, y1: 0, x2: s.x, y2: "100%" as const };
            return (
              <g key={i}>
                <line {...line} stroke="var(--color-guide)" strokeWidth={1} />
                {!doc.canvas.guidesLocked ? (
                  <line
                    {...line}
                    stroke="transparent"
                    strokeWidth={9}
                    className="pointer-events-auto"
                    style={{ cursor: horiz ? "row-resize" : "col-resize" }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return; // left only — middle-drag stays a pan
                      startGuideMove(i, g.orient, e);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setGuideMenu({ x: e.clientX, y: e.clientY, index: i });
                    }}
                  />
                ) : null}
              </g>
            );
          })}
          {guideDraft
            ? (() => {
                const horiz = guideDraft.orient === "h";
                const s = canvasToScreen(viewport, horiz ? v2(0, guideDraft.at) : v2(guideDraft.at, 0));
                const line = horiz
                  ? { x1: 0, y1: s.y, x2: "100%" as const, y2: s.y }
                  : { x1: s.x, y1: 0, x2: s.x, y2: "100%" as const };
                return <line {...line} stroke="var(--color-guide)" strokeWidth={1} strokeDasharray="4 3" opacity={guideDraft.over ? 1 : 0.4} />;
              })()
            : null}
        </svg>
      ) : null}
      {/* floating position readout while dragging a guide (new or existing) — origin-relative, to match the rulers */}
      {(() => {
        const tip = guideDraft ? { orient: guideDraft.orient, at: guideDraft.at } : guideDrag;
        if (!tip) return null;
        const horiz = tip.orient === "h";
        const s = canvasToScreen(viewport, horiz ? v2(0, tip.at) : v2(tip.at, 0));
        const rel = tip.at - (horiz ? doc.canvas.origin.y : doc.canvas.origin.x);
        const label = `${horiz ? "y" : "x"} ${Number.isInteger(rel) ? rel : rel.toFixed(1)}`;
        const style = horiz
          ? { top: s.y, left: 6, transform: "translateY(-50%)" }
          : { left: s.x, top: 6, transform: "translateX(-50%)" };
        return (
          <div
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded-sm border border-border px-1.5 py-0.5 text-sm font-medium text-fg shadow-md"
            style={{ background: "var(--color-surface2)", ...style }}
          >
            {label}
          </div>
        );
      })()}
      {/* mirror axes: faint dashed line(s) through a selected mirror group's origin along its seam(s) */}
      {(() => {
        const sel = state.selectedId ? findNode(doc.layers, state.selectedId) : null;
        if (!sel || !isGroup(sel) || !sel.mirror || sel.mirror === "none" || sel.mirrorEnabled === false) return null;
        const aff = nodeWorldAffine(doc.layers, sel.id);
        if (!aff) return null;
        const o = canvasToScreen(viewport, v2(aff.e, aff.f)); // group origin in screen px
        // seam for an x-mirror is the local Y axis (world dir = affine col b,d); for y-mirror the
        // local X axis (col a,c). quad shows both.
        const axes: { dx: number; dy: number }[] = [];
        if (sel.mirror === "x" || sel.mirror === "quad") axes.push({ dx: aff.b, dy: aff.d });
        if (sel.mirror === "y" || sel.mirror === "quad") axes.push({ dx: aff.a, dy: aff.c });
        const L = 4000;
        return (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {axes.map((ax, i) => {
              const len = Math.hypot(ax.dx, ax.dy) || 1;
              const ux = (ax.dx / len) * L;
              const uy = (ax.dy / len) * L;
              return (
                <line
                  key={i}
                  x1={o.x - ux}
                  y1={o.y - uy}
                  x2={o.x + ux}
                  y2={o.y + uy}
                  stroke="var(--color-mirror)"
                  strokeWidth={1}
                  strokeDasharray="6 4"
                  opacity={0.7}
                />
              );
            })}
          </svg>
        );
      })()}
      <Gizmos
        doc={doc}
        selectedId={state.selectedId}
        viewport={viewport}
        store={store}
        tool={tool}
        selVerts={selVerts}
        setSelVerts={setSelVerts}
        setPlacing={setPlacing}
        snap={snap}
        maskFocus={maskFocus}
      />
      {/* click-to-place ghost: dashed tether from the anchor to the cursor + a hollow dot */}
      {(() => {
        if (!placing || !placeCursor) return null;
        const object = findObject(placing.objectId);
        if (!object) return null;
        const originLocal =
          placing.kind === "cable-end"
            ? (placing.end === "end" ? object.bezier?.[object.bezier.length - 1] : object.bezier?.[0])?.p
            : object.controlPoints[placing.afterIndex];
        if (!originLocal) return null;
        const o = canvasToScreen(viewport, fromLocal(object.transform, originLocal));
        const c = canvasToScreen(viewport, placeCursor);
        return (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <line x1={o.x} y1={o.y} x2={c.x} y2={c.y} stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" />
            <circle cx={c.x} cy={c.y} r={5} fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth={1.5} />
          </svg>
        );
      })()}
      {tool === "pen" && penPts.length > 0
        ? (() => {
            const scr = penPts.map((p) => canvasToScreen(viewport, p));
            const cur = cursor ? canvasToScreen(viewport, cursor) : scr[scr.length - 1]!;
            const path = scr.map((s) => `${s.x},${s.y}`).join(" ");
            return (
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                <polyline points={path} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />
                <line
                  x1={scr[scr.length - 1]!.x}
                  y1={scr[scr.length - 1]!.y}
                  x2={cur.x}
                  y2={cur.y}
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                {scr.map((s, i) => (
                  <circle
                    key={i}
                    cx={s.x}
                    cy={s.y}
                    r={i === 0 ? 6 : 4}
                    fill={i === 0 ? "var(--color-accent)" : "var(--color-bg)"}
                    stroke="var(--color-accent)"
                    strokeWidth={1.5}
                  />
                ))}
              </svg>
            );
          })()
        : null}
      {/* hover-pick outline: the footprint quad of the object a click would grab (skipped once it's
          already selected — the gizmo frame takes over there) */}
      {hoverId && !state.selectedIds.includes(hoverId)
        ? (() => {
            const node = findNode(doc.layers, hoverId);
            if (!node || !isObject(node)) return null;
            const aff = nodeWorldAffine(doc.layers, hoverId);
            if (!aff) return null;
            const lb = localBounds(node);
            const pts = [v2(lb.min.x, lb.min.y), v2(lb.max.x, lb.min.y), v2(lb.max.x, lb.max.y), v2(lb.min.x, lb.max.y)]
              .map((c) => canvasToScreen(viewport, affineApply(aff, c)))
              .map((s) => `${s.x},${s.y}`)
              .join(" ");
            return (
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                <polygon points={pts} fill="none" stroke="var(--color-accent)" strokeOpacity={0.5} strokeDasharray="3 3" />
              </svg>
            );
          })()
        : null}
      {/* measure-tool overlay: the snapped segment + a floating length/Δ/angle readout */}
      {measure
        ? (() => {
            const a = canvasToScreen(viewport, measure.a);
            const b = canvasToScreen(viewport, measure.b);
            const dx = measure.b.x - measure.a.x;
            const dy = measure.b.y - measure.a.y;
            const len = Math.hypot(dx, dy);
            const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
            const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
            return (
              <>
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-guide)" strokeWidth={1.5} />
                  <circle cx={a.x} cy={a.y} r={3} fill="var(--color-guide)" />
                  <circle cx={b.x} cy={b.y} r={3} fill="var(--color-guide)" />
                </svg>
                <div
                  className="pointer-events-none absolute border border-border bg-surface2/95 px-2 py-1 font-mono text-base text-fg"
                  style={{ left: (a.x + b.x) / 2 + 10, top: (a.y + b.y) / 2 + 10 }}
                >
                  {fmt(len)} px
                  <span className="ml-2 text-fg-mid">
                    Δ {fmt(dx)}, {fmt(dy)} · {fmt(deg)}°
                  </span>
                </div>
              </>
            );
          })()
        : null}
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
          <span className="text-sm uppercase tracking-wide text-fg-mid">energy</span>
          <div className="mt-0.5 w-[84px]">
            <SpinSlider value={view.lightEnergy} min={0} max={2} onChange={onEnergyChange} />
          </div>
        </div>
      ) : null}
      {diffuseBytes && !swapped
        ? (() => {
            const sel = findObject(state.selectedId);
            const objectKind: GuideContext["objectKind"] = !sel
              ? "none"
              : getObjectType(sel.typeId).controlPoints.kind === "none" && sel.bezier
                ? "cable" // analytic Bézier path (Pipe/Berm) — open-path editing shortcuts
                : (getObjectType(sel.typeId).controlPoints.kind as GuideContext["objectKind"]);
            return (
              <ShortcutGuide
                position="absolute"
                storageKey="lambert.guide2d.open"
                sections={guide2D({ tool, objectKind, placing: !!placing })}
              />
            );
          })()
        : null}
      {diffuseBytes ? (
        <div className="pointer-events-none absolute bottom-2 left-2 flex gap-3 border border-border bg-surface2/90 px-2 py-0.5 text-sm tabular-nums text-fg-mid">
          <span title="Zoom (Ctrl+0 fit, Ctrl+1 100%)" className="text-fg">
            {Math.round(viewport.zoom * 100)}%
          </span>
          {cursor ? (
            <span>
              {cursor.x - doc.canvas.origin.x}, {cursor.y - doc.canvas.origin.y}
            </span>
          ) : null}
        </div>
      ) : null}
      {bodyMenu
        ? (() => {
            const s = findObject(bodyMenu.id);
            return s ? (
              <ContextMenu x={bodyMenu.x} y={bodyMenu.y} items={bodyMenuItems(s)} onClose={() => setBodyMenu(null)} />
            ) : null;
          })()
        : null}
      {guideMenu ? (
        <ContextMenu
          x={guideMenu.x}
          y={guideMenu.y}
          onClose={() => setGuideMenu(null)}
          items={[
            { label: "Delete Guide", danger: true, onClick: () => store.commit((x) => removeGuide(x, guideMenu.index)) },
            { label: "Clear All Guides", onClick: () => store.commit(clearGuides) },
          ]}
        />
      ) : null}
      </div>
    </div>
  );
}
