import { useEffect, useRef, useState } from "react";
import type { DocumentStore, EditorState } from "../document/store";
import { addShape, cloneShape, duplicateShape, moveShapeTo, removeShape, updateShape } from "../document/docOps";
import { addGuide, clearGuides, moveGuide, removeGuide } from "../document/canvasOps";
import { bezierAnchor } from "../field/bezier";
import { createMask } from "../field/maskOps";
import { flattenLayers } from "../field/flatten";
import { findNode, findParentId, nodeWorldAffine, updateNode } from "../document/layerOps";
import { affineApply, affineIdentity, affineInvert } from "../field/affine";
import { isGroup, isShape } from "../field/types";
import { insertVertex } from "../field/controlPoints";
import { getShapeType } from "../field/registry";
import { snapHalf } from "../field/snap";
import { snapCanvasPoint } from "./snapPoint";
import { fromLocal, toLocal } from "../field/transform";
import type { ShapeInstance } from "../field/types";
import { normalSigns, type NormalDirs } from "../document/schema";
import { Vector2, Vector3 } from "@carapace/primitives";
import { v2 } from "../field/vec";
import { ContextMenu, type MenuEntry } from "./kit";
import { Gizmos } from "./Gizmos";
import { LightPad } from "./LightPad";
import { axisScaleFromDrag, constrainAxis, pickShape, pointsInBox, rotationFromDrag, snapAngle } from "./picking";
import { PreviewRenderer } from "./preview";
import { RULER, Rulers } from "./Rulers";
import { guide2D, type GuideContext } from "./keymap";
import { ShortcutGuide } from "./ShortcutGuide";
import type { Orbit } from "../field/gpu/preview3d";
import { canvasToScreen, fitViewport, screenToCanvas, Viewport, zoomAt } from "./viewport";
import type { Placing, ToolMode } from "./tools";
import type { ViewState } from "./App";

const ROTATE_SNAP = Math.PI / 12; // 15 deg, godot default rotation snap step

type Drag =
  | { kind: "pan"; lastX: number; lastY: number }
  // moved: crossed the click-vs-drag threshold (until then the drag writes nothing). dupOnMove: this
  // is an Alt-drag, so the first real move clones the shape and the copy is what gets dragged.
  // group: present for a multi-selection drag — each selected node's start pos + its parent's inverse
  // linear (world delta -> that node's local delta), so they all move together by the same world delta.
  | {
      kind: "move";
      id: string;
      startCanvas: Vector2;
      startPos: Vector2;
      moved?: boolean;
      dupOnMove?: boolean;
      group?: { id: string; startX: number; startY: number; il: { a: number; b: number; c: number; d: number } }[];
    }
  | { kind: "rotate"; id: string; startCanvas: Vector2; startRotation: number; pivot: Vector2; moved?: boolean }
  | {
      kind: "scale";
      id: string;
      startCanvas: Vector2;
      startScale: Vector3;
      pivot: Vector2;
      rotation: number;
      moved?: boolean;
    }
  | { kind: "marquee"; startCanvas: Vector2; current: Vector2; additive: boolean; base: number[]; moved: boolean };

export function CanvasView(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  tool: ToolMode;
  diffuseBytes: Uint8Array | null;
  selVerts: number[];
  setSelVerts: (v: number[] | ((p: number[]) => number[])) => void;
  onLightChange: (dir: [number, number, number]) => void;
  canvas3dRef: React.RefObject<HTMLCanvasElement | null>;
  orbit3d: Orbit;
  /** Project normal-channel convention (project.lambert), for the normal-view encode. */
  normalDirs: NormalDirs;
  /** 3D preview is occupying the big slot (this 2D view is hidden behind it) — hide the 2D guide. */
  swapped: boolean;
  /** Per-image viewport persistence: the image key, its saved pan/zoom (undefined = not yet fitted),
   *  and a reporter so App can stash it per-image (survives tab switch + reload). */
  imagePath: string;
  savedViewport: Viewport | undefined;
  onViewportChange: (vp: Viewport) => void;
  /** Switch the active tool (double-click a control-point shape to jump into vertex editing). */
  setTool: (t: ToolMode) => void;
  /** Global ½px grid snap (positions, vertices, polygon + curve points). */
  snap: boolean;
  /** Show the top/left rulers (insets the canvas area). */
  rulers: boolean;
}): React.JSX.Element {
  const { store, state, view, tool, diffuseBytes, selVerts, setSelVerts, onLightChange, canvas3dRef, orbit3d, normalDirs, swapped } =
    props;
  const { imagePath, savedViewport, onViewportChange, setTool, snap, rulers } = props;
  const inset = rulers ? RULER : 0;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 }); // inset canvas-area size, for the rulers
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState<Vector2 | null>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const viewportRef = useRef(viewport); // for window-level drag closures (guide drag)
  viewportRef.current = viewport;
  const dragRef = useRef<Drag | null>(null);
  // a guide being dragged out of a ruler (not yet committed); `over` = cursor is over the canvas area
  const [guideDraft, setGuideDraft] = useState<{ orient: "v" | "h"; at: number; over: boolean } | null>(null);
  const [guideMenu, setGuideMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Vector2; b: Vector2 } | null>(null);
  // click-to-place ("pen") mode: a new point follows the cursor; left-click drops it (chains)
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [placeCursor, setPlaceCursor] = useState<Vector2 | null>(null);
  const [bodyMenu, setBodyMenu] = useState<{ x: number; y: number; id: string } | null>(null); // right-click a shape
  // leaving the shape ends placing; Esc / Enter end it too
  useEffect(() => setPlacing(null), [state.selectedId]);
  // seed the pen ghost at the last cursor so it's visible immediately on entering placing mode
  useEffect(() => {
    if (placing) setPlaceCursor((pc) => pc ?? cursorRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing]);
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" || e.key === "Enter") setPlacing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  // mask pen: a draft of placed points (canvas/world space); committed into a Mask on close
  const [penPts, setPenPts] = useState<Vector2[]>([]);
  const CLOSE_PX = 10; // screen px: clicking within this of the first point closes the loop
  useEffect(() => setPenPts([]), [tool, state.selectedId, imagePath]); // leaving pen abandons the draft
  useEffect(() => {
    if (tool !== "pen") return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" || e.key === "Enter") setPenPts([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  const doc = state.doc;
  // find a SHAPE leaf by id (groups return undefined — the canvas edits shapes; groups via the gizmo)
  const findShape = (sid: string | null): ShapeInstance | undefined => {
    if (!sid) return undefined;
    const n = findNode(doc.layers, sid);
    return n && isShape(n) ? n : undefined;
  };

  // grid + guide snap for any world point being edited (no-op when both toggles are off)
  const snapPt = (p: Vector2): Vector2 =>
    snapCanvasPoint(p, { grid: snap, guides: doc.canvas.snapToGuides, guideLines: doc.canvas.guides, zoom: viewport.zoom });

  // host-area screen point -> { docX, docY, over } where `over` is "cursor is inside the canvas area"
  const hostPoint = (e: PointerEvent): { docX: number; docY: number; over: boolean } => {
    const r = hostRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const p = screenToCanvas(viewportRef.current, v2(sx, sy));
    return { docX: p.x, docY: p.y, over: sx >= 0 && sy >= 0 && sx <= r.width && sy <= r.height };
  };

  // pull a new guide out of a ruler: top strip -> horizontal guide (at = doc-y), left -> vertical (at = doc-x).
  // Live line follows; release over the canvas commits, release over a ruler cancels.
  const startGuideCreate = (orient: "v" | "h"): void => {
    const at0 = orient === "h" ? hostSize.h / 2 : hostSize.w / 2;
    setGuideDraft({ orient, at: at0, over: false });
    const move = (e: PointerEvent): void => {
      const { docX, docY, over } = hostPoint(e);
      const raw = orient === "h" ? docY : docX;
      setGuideDraft({ orient, at: snap ? snapHalf(raw) : raw, over });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuideDraft((d) => {
        if (d && d.over) {
          store.update((x) => addGuide(x, { orient: d.orient, at: d.at }));
          store.endGesture();
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // drag an existing guide along its cross axis; dropping it back over its ruler deletes it
  const startGuideMove = (index: number, orient: "v" | "h", e: React.PointerEvent): void => {
    e.stopPropagation();
    const move = (ev: PointerEvent): void => {
      const { docX, docY } = hostPoint(ev);
      const raw = orient === "h" ? docY : docX;
      store.update((x) => moveGuide(x, index, snap ? snapHalf(raw) : raw), { coalesce: `guide:${index}` });
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const r = hostRef.current!.getBoundingClientRect();
      const offRuler = orient === "h" ? ev.clientY - r.top < 0 : ev.clientX - r.left < 0;
      if (offRuler) store.update((x) => removeGuide(x, index));
      store.endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // init renderer + canvas sizing
  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    const resize = (): void => {
      const r = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(r.height * devicePixelRatio));
      setHostSize({ w: r.width, h: r.height });
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
    window.addEventListener("lambert-zoom", onZoom);
    return () => window.removeEventListener("lambert-zoom", onZoom);
  }, [doc.source.width, doc.source.height]);

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

  // upload diffuse when it changes
  useEffect(() => {
    if (!ready || !rendererRef.current || !diffuseBytes) return;
    rendererRef.current.setDiffuse(diffuseBytes, doc.source.width, doc.source.height);
  }, [ready, diffuseBytes, doc.source.width, doc.source.height]);

  // viewport persistence: when the active image changes, seed the view from its saved pan/zoom (or
  // fit on first open); report every change up so App stashes it per-image. Refs keep the seed effect
  // from re-firing on the reporter's identity or on the saved value echoing back.
  const savedViewportRef = useRef(savedViewport);
  savedViewportRef.current = savedViewport;
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  useEffect(() => {
    const rect = hostRef.current!.getBoundingClientRect();
    setViewport(savedViewportRef.current ?? fitViewport(doc.source.width, doc.source.height, rect.width, rect.height, 40));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePath]);
  useEffect(() => {
    onViewportChangeRef.current(viewport);
  }, [viewport]);

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
      normalSigns: normalSigns(normalDirs),
      raster: view.raster,
      fullPipeline: view.fullPipeline,
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
    const shape = findShape(placing.shapeId);
    if (!shape) return setPlacing(null);
    const local = toLocal(shape.transform, snapPt(canvasPt));
    if (placing.kind === "cable-end") {
      store.update((d) =>
        updateShape(d, placing.shapeId, (s) =>
          s.bezier
            ? { ...s, bezier: placing.end === "end" ? [...s.bezier, bezierAnchor(local)] : [bezierAnchor(local), ...s.bezier] }
            : s,
        ),
      );
      store.endGesture(); // the end stays the end — the rubber-band re-reads the new anchor next render
    } else {
      store.update((d) =>
        updateShape(d, placing.shapeId, (s) => ({ ...s, controlPoints: insertVertex(s.controlPoints, placing.afterIndex, local) })),
      );
      store.endGesture();
      setSelVerts([placing.afterIndex + 1]);
      setPlacing({ ...placing, afterIndex: placing.afterIndex + 1 }); // chain from the point just placed
    }
  };

  // close the pen draft into a keep mask (follow=true: stored in the target's local frame). Targets
  // the selected node — a shape OR a group — converting through its full world affine (so a mask on a
  // nested shape or a group lands in the right frame).
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
          if (Math.hypot(sx - first.x, sy - first.y) <= CLOSE_PX) return commitMask(penPts);
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
    // ends when the cursor leaves the canvas or releases off-window.
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      dragRef.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
      return;
    }
    const p = toCanvasPoint(e);

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

    // start a body move-drag. With >1 selected, capture every selected node's start pos + its parent's
    // inverse linear so the whole selection moves by one shared world delta. dup = Alt-drag a single copy.
    const beginMove = (hit: ShapeInstance, dup: boolean): void => {
      const sel = state.selectedIds;
      const group =
        sel.length > 1
          ? sel
              .map((sid) => {
                const node = findNode(doc.layers, sid);
                if (!node) return null;
                const parentId = findParentId(doc.layers, sid);
                const pAff = parentId ? nodeWorldAffine(doc.layers, parentId) : null;
                const inv = pAff ? affineInvert(pAff) : affineIdentity();
                return { id: sid, startX: node.transform.pos.x, startY: node.transform.pos.y, il: { a: inv.a, b: inv.b, c: inv.c, d: inv.d } };
              })
              .filter((g): g is NonNullable<typeof g> => g !== null)
          : undefined;
      dragRef.current = {
        kind: "move",
        id: hit.id,
        startCanvas: p,
        startPos: v2(hit.transform.pos.x, hit.transform.pos.y),
        dupOnMove: dup || undefined,
        group: dup ? undefined : group, // Alt-dup is single-shape only
      };
    };

    if (tool === "vertex") {
      // vertex tool: the body never grabs drags. Clicking a different shape picks it for
      // editing; otherwise any drag is a marquee (works over the body too — solves interior
      // verts). Clicking a vertex dot is handled by the gizmo (it stops propagation).
      const hit = pickShape(flattenLayers(doc.layers), p);
      if (hit && hit.id !== state.selectedId) {
        store.select(hit.id);
        return;
      }
      beginMarquee();
      return;
    }

    if (tool === "select") {
      // only the pointer picks by clicking; other tools select via the layer panel
      const hit = pickShape(flattenLayers(doc.layers), p);
      if (hit) {
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
      // empty space: begin a vertex marquee (a plain click with no drag still deselects on
      // up). Dragging from here box-selects the selected shape's vertices — never conflicts
      // with shape-move (that starts on the body) or vertex drag (that starts on a dot).
      beginMarquee();
      return;
    }

    // explicit tools operate on the current selection only, wherever you grab;
    // locked layers are inert on canvas (inspector still edits them)
    const target = findShape(state.selectedId) ?? null;
    if (!target || target.locked) return;
    if (tool === "move") {
      dragRef.current = { kind: "move", id: target.id, startCanvas: p, startPos: v2(target.transform.pos.x, target.transform.pos.y) };
    } else if (tool === "rotate") {
      dragRef.current = {
        kind: "rotate",
        id: target.id,
        startCanvas: p,
        startRotation: target.transform.rotation,
        pivot: v2(target.transform.pos.x, target.transform.pos.y),
      };
    } else {
      dragRef.current = {
        kind: "scale",
        id: target.id,
        startCanvas: p,
        startScale: target.transform.scale,
        pivot: v2(target.transform.pos.x, target.transform.pos.y),
        rotation: target.transform.rotation,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const cp = toCanvasPoint(e);
    setCursor(v2(Math.floor(cp.x), Math.floor(cp.y)));
    if (placing) setPlaceCursor(cp);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      setViewport((vp) => ({ ...vp, panX: vp.panX + e.clientX - drag.lastX, panY: vp.panY + e.clientY - drag.lastY }));
      dragRef.current = { ...drag, lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (drag.kind === "marquee") {
      // only a control-point shape can be box-selected; otherwise the empty drag is inert
      const sel = findShape(state.selectedId);
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
    // click-vs-drag: a transform drag writes nothing (and doesn't dirty the doc) until the pointer
    // moves past a few px. Once moved it stays moved, so dragging back to the start still tracks. The
    // first crossing is also where a deferred Alt-drag clones the shape and hands the drag to the copy.
    if (drag.kind === "move" || drag.kind === "rotate" || drag.kind === "scale") {
      if (!drag.moved) {
        if (Math.hypot(cp.x - drag.startCanvas.x, cp.y - drag.startCanvas.y) * viewport.zoom <= 3) return;
        drag.moved = true;
        if (drag.kind === "move" && drag.dupOnMove) {
          const orig = findShape(drag.id);
          if (orig) {
            const copy = cloneShape(orig, 0, 0);
            store.update((d) => ({ ...d, layers: [...d.layers, copy] }));
            store.select(copy.id);
            drag.id = copy.id;
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
      if (drag.group) {
        // multi-move: one shared WORLD delta (grid-snapped) applied to every selected node, each
        // converted into its own parent's local frame so groups/nesting move correctly together.
        const wdx = snap ? snapHalf(dx) : dx;
        const wdy = snap ? snapHalf(dy) : dy;
        store.update(
          (d) => {
            let layers = d.layers;
            for (const g of drag.group!) {
              const ldx = g.il.a * wdx + g.il.b * wdy;
              const ldy = g.il.c * wdx + g.il.d * wdy;
              layers = updateNode(layers, g.id, (n) => ({
                ...n,
                transform: { ...n.transform, pos: n.transform.pos.withX(g.startX + ldx).withY(g.startY + ldy) },
              }));
            }
            return { ...d, layers };
          },
          { coalesce: "multimove" },
        );
        return;
      }
      store.update(
        (d) =>
          updateShape(d, drag.id, (s) => {
            const sp = snapPt(v2(drag.startPos.x + dx, drag.startPos.y + dy));
            const pos = s.transform.pos.withX(sp.x).withY(sp.y);
            return { ...s, transform: { ...s.transform, pos } };
          }),
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
    e.stopPropagation(); // don't let zoom-scroll leak to the surrounding layout (matches the 3D view)
    const rect = hostRef.current!.getBoundingClientRect();
    setViewport((vp) => zoomAt(vp, v2(e.clientX - rect.left, e.clientY - rect.top), e.deltaY < 0 ? 1.2 : 1 / 1.2));
  };

  const pointAt = (e: React.MouseEvent): Vector2 => {
    const rect = hostRef.current!.getBoundingClientRect();
    return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
  };

  // right-click a shape body for its verbs (vertex/edge/anchor menus are handled by the gizmo, which
  // stops propagation, so this only fires on the plain body or empty canvas)
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    if (placing) {
      setPlacing(null);
      return;
    }
    const hit = pickShape(flattenLayers(doc.layers), pointAt(e));
    if (hit) {
      store.select(hit.id);
      setBodyMenu({ x: e.clientX, y: e.clientY, id: hit.id });
    } else {
      setBodyMenu(null);
    }
  };

  // double-click a control-point shape to jump straight into vertex editing (the universal gesture)
  const onDoubleClick = (e: React.MouseEvent): void => {
    const hit = pickShape(flattenLayers(doc.layers), pointAt(e));
    if (hit && getShapeType(hit.typeId).controlPoints.kind !== "none") {
      store.select(hit.id);
      setTool("vertex");
    }
  };

  const bodyMenuItems = (s: ShapeInstance): MenuEntry[] => {
    const items: MenuEntry[] = [];
    if (getShapeType(s.typeId).controlPoints.kind !== "none") {
      items.push({ label: "Edit Vertices", onClick: () => { store.select(s.id); setTool("vertex"); } });
      items.push("separator");
    }
    const op = (fn: (d: typeof state.doc) => typeof state.doc): void => { store.update(fn); store.endGesture(); };
    items.push({ label: "Duplicate", hotkey: "Ctrl+D", onClick: () => op((d) => duplicateShape(d, s.id)) });
    items.push({ label: "Bring to Front", onClick: () => op((d) => moveShapeTo(d, s.id, Number.MAX_SAFE_INTEGER)) });
    items.push({ label: "Send to Back", onClick: () => op((d) => moveShapeTo(d, s.id, 0)) });
    items.push({ label: s.locked ? "Unlock" : "Lock", onClick: () => op((d) => updateShape(d, s.id, (sh) => ({ ...sh, locked: !sh.locked }))) });
    items.push("separator");
    items.push({ label: "Delete", danger: true, hotkey: "⌫", onClick: () => op((d) => removeShape(d, s.id)) });
    return items;
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    if (!diffuseBytes) return; // no document: nothing to author against
    const typeId = e.dataTransfer.getData("application/x-lambert-shape");
    if (!typeId) return;
    const rect = hostRef.current!.getBoundingClientRect();
    const p = screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
    store.update((d) => addShape(d, typeId, p));
    store.endGesture();
  };

  const toolCursor = placing || tool === "pen"
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
        onWheel={onWheel}
        onContextMenu={onContextMenu}
        onDoubleClick={onDoubleClick}
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
                <line {...line} stroke="#46b8c0" strokeWidth={1} />
                {!doc.canvas.guidesLocked ? (
                  <line
                    {...line}
                    stroke="transparent"
                    strokeWidth={9}
                    className="pointer-events-auto"
                    style={{ cursor: horiz ? "row-resize" : "col-resize" }}
                    onPointerDown={(e) => startGuideMove(i, g.orient, e)}
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
                return <line {...line} stroke="#46b8c0" strokeWidth={1} strokeDasharray="4 3" opacity={guideDraft.over ? 1 : 0.4} />;
              })()
            : null}
        </svg>
      ) : null}
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
                  stroke="#c061cb"
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
      />
      {/* click-to-place ghost: dashed tether from the anchor to the cursor + a hollow dot */}
      {(() => {
        if (!placing || !placeCursor) return null;
        const shape = findShape(placing.shapeId);
        if (!shape) return null;
        const originLocal =
          placing.kind === "cable-end"
            ? (placing.end === "end" ? shape.bezier?.[shape.bezier.length - 1] : shape.bezier?.[0])?.p
            : shape.controlPoints[placing.afterIndex];
        if (!originLocal) return null;
        const o = canvasToScreen(viewport, fromLocal(shape.transform, originLocal));
        const c = canvasToScreen(viewport, placeCursor);
        return (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <line x1={o.x} y1={o.y} x2={c.x} y2={c.y} stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" />
            <circle cx={c.x} cy={c.y} r={5} fill="var(--color-accent)" stroke="#191a1b" strokeWidth={1.5} />
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
                    fill={i === 0 ? "var(--color-accent)" : "#191a1b"}
                    stroke="var(--color-accent)"
                    strokeWidth={1.5}
                  />
                ))}
              </svg>
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
          <span className="text-sm uppercase tracking-[var(--tracking-tight)] text-fg-mid">light</span>
        </div>
      ) : null}
      {diffuseBytes && !swapped
        ? (() => {
            const sel = findShape(state.selectedId);
            const shapeKind: GuideContext["shapeKind"] = !sel
              ? "none"
              : sel.typeId === "cable"
                ? "cable"
                : (getShapeType(sel.typeId).controlPoints.kind as GuideContext["shapeKind"]);
            return (
              <ShortcutGuide
                storageKey="lambert.guide2d.open"
                sections={guide2D({ tool, shapeKind, placing: !!placing })}
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
            const s = findShape(bodyMenu.id);
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
            { label: "Delete Guide", danger: true, onClick: () => { store.update((x) => removeGuide(x, guideMenu.index)); store.endGesture(); } },
            { label: "Clear All Guides", onClick: () => { store.update(clearGuides); store.endGesture(); } },
          ]}
        />
      ) : null}
      </div>
    </div>
  );
}
