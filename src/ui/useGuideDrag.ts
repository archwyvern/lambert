import { useState } from "react";
import type { Vector2 } from "@aphralatrax/primitives";
import { addGuide, moveGuide, removeGuide } from "../document/canvasOps";
import type { DocumentStore } from "../document/store";
import { snapHalf } from "../field/snap";
import { v2 } from "../field/vec";
import { screenToCanvas, Viewport } from "./viewport";

/**
 * Ruler-guide creation + dragging (QC-CARRY-1 extraction from CanvasView). Pull a new guide out of a
 * ruler (live dashed draft; release over the canvas commits, over a ruler cancels) or drag an existing
 * guide along its cross axis (dropping it back on its ruler deletes it). Both run window-level pointer
 * listeners so the drag keeps tracking outside the host; the viewport comes through a ref so the
 * closures never go stale mid-drag.
 */
export function useGuideDrag(opts: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<Viewport>;
  /** Inset canvas-area size (the draft guide seeds at the view centre). */
  hostSize: { w: number; h: number };
  store: DocumentStore;
  /** Global ½px grid snap. */
  snap: boolean;
}): {
  /** A new guide being pulled out of a ruler (not yet committed); `over` = cursor is over the canvas. */
  guideDraft: { orient: "v" | "h"; at: number; over: boolean } | null;
  /** An existing guide being dragged — drives the floating position tooltip. */
  guideDrag: { orient: "v" | "h"; at: number } | null;
  startGuideCreate: (orient: "v" | "h") => void;
  startGuideMove: (index: number, orient: "v" | "h", e: React.PointerEvent) => void;
} {
  const { hostRef, viewportRef, hostSize, store, snap } = opts;
  const [guideDraft, setGuideDraft] = useState<{ orient: "v" | "h"; at: number; over: boolean } | null>(null);
  const [guideDrag, setGuideDrag] = useState<{ orient: "v" | "h"; at: number } | null>(null);

  // host-area screen point -> { docX, docY, over } where `over` is "cursor is inside the canvas area"
  const hostPoint = (e: PointerEvent): { docX: number; docY: number; over: boolean } => {
    const r = hostRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const p: Vector2 = screenToCanvas(viewportRef.current, v2(sx, sy));
    return { docX: p.x, docY: p.y, over: sx >= 0 && sy >= 0 && sx <= r.width && sy <= r.height };
  };

  const startGuideCreate = (orient: "v" | "h"): void => {
    // seed at the view CENTRE in DOC space — `at` is a doc coordinate, so the old hostSize/2 (screen px)
    // drew the draft line at the wrong place for one frame until the first move corrected it.
    const centre = screenToCanvas(viewportRef.current, v2(hostSize.w / 2, hostSize.h / 2));
    const at0 = orient === "h" ? centre.y : centre.x;
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
        if (d && d.over) store.commit((x) => addGuide(x, { orient: d.orient, at: d.at }));
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startGuideMove = (index: number, orient: "v" | "h", e: React.PointerEvent): void => {
    e.stopPropagation();
    const move = (ev: PointerEvent): void => {
      const { docX, docY } = hostPoint(ev);
      const raw = orient === "h" ? docY : docX;
      const at = snap ? snapHalf(raw) : raw;
      setGuideDrag({ orient, at });
      store.update((x) => moveGuide(x, index, at), { coalesce: `guide:${index}` });
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuideDrag(null);
      const r = hostRef.current!.getBoundingClientRect();
      const offRuler = orient === "h" ? ev.clientY - r.top < 0 : ev.clientX - r.left < 0;
      if (offRuler) store.update((x) => removeGuide(x, index));
      store.endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { guideDraft, guideDrag, startGuideCreate, startGuideMove };
}
