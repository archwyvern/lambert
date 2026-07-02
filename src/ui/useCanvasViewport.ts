import { useEffect, useRef, useState } from "react";
import type { EditorState } from "../document/store";
import { affineApply } from "../field/affine";
import { nodeWorldAffine } from "../document/layerOps";
import { isGroup, isObject } from "../field/types";
import { v2 } from "../field/vec";
import { localBounds } from "./objectBounds";
import { fitBounds, fitViewport, Viewport, zoomAt } from "./viewport";

/**
 * The 2D canvas viewport: pan/zoom state plus everything that drives it from outside a pointer drag —
 * per-tab seeding/persistence, the menu zoom actions (Fit / Fit Selection / 100%, via the
 * `lambert-zoom` window event), and wheel zoom (a NATIVE non-passive listener on the host, because
 * React's onWheel is passive so preventDefault can't stop Electron's Ctrl+wheel page zoom).
 * Extracted from CanvasView (QC-CARRY-1); pointer-drag panning stays with the drag machinery.
 */
export function useCanvasViewport(opts: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** Stable id of the active tab — switching tabs re-seeds from that tab's saved viewport. */
  tabId: string;
  docW: number;
  docH: number;
  /** The tab's saved pan/zoom (undefined = first open -> fit). */
  savedViewport: Viewport | undefined;
  /** Reports every viewport change so the owner can stash it per-tab. */
  onViewportChange: (vp: Viewport) => void;
  /** Live selection/layers for zoom-to-selection (a ref, so the window listener never goes stale). */
  stateRef: React.RefObject<EditorState>;
}): { viewport: Viewport; setViewport: React.Dispatch<React.SetStateAction<Viewport>> } {
  const { hostRef, tabId, docW, docH, savedViewport, onViewportChange, stateRef } = opts;
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });

  // per-tab persistence: seed from the tab's saved pan/zoom (or fit on first open); report every
  // change up. Refs keep the seed effect from re-firing on the reporter's identity or on the saved
  // value echoing back.
  const savedViewportRef = useRef(savedViewport);
  savedViewportRef.current = savedViewport;
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  useEffect(() => {
    const rect = hostRef.current!.getBoundingClientRect();
    setViewport(savedViewportRef.current ?? fitViewport(docW, docH, rect.width, rect.height, 40));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);
  useEffect(() => {
    onViewportChangeRef.current(viewport);
  }, [viewport]);

  // menu-driven zoom (accelerators are owned by the application menu)
  useEffect(() => {
    const onZoom = (e: Event): void => {
      const action = (e as CustomEvent<string>).detail;
      const rect = hostRef.current!.getBoundingClientRect();
      if (action === "zoom-fit") {
        setViewport(fitViewport(docW, docH, rect.width, rect.height, 40));
      } else if (action === "zoom-100") {
        setViewport({ zoom: 1, panX: (rect.width - docW) / 2, panY: (rect.height - docH) / 2 });
      } else if (action === "zoom-fit-selection") {
        // union the WORLD footprints of every selected object (a selected group contributes all its
        // object descendants), then fit that box. Falls through silently if nothing has a footprint.
        const st = stateRef.current;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const collect = (node: (typeof st.doc.layers)[number], selectedAncestor: boolean): void => {
          const selected = selectedAncestor || st.selectedIds.includes(node.id);
          if (isObject(node)) {
            if (!selected) return;
            const lb = localBounds(node);
            const aff = nodeWorldAffine(st.doc.layers, node.id);
            if (!aff) return;
            for (const c of [v2(lb.min.x, lb.min.y), v2(lb.max.x, lb.min.y), v2(lb.max.x, lb.max.y), v2(lb.min.x, lb.max.y)]) {
              const w = affineApply(aff, c);
              minX = Math.min(minX, w.x);
              minY = Math.min(minY, w.y);
              maxX = Math.max(maxX, w.x);
              maxY = Math.max(maxY, w.y);
            }
          } else if (isGroup(node)) {
            for (const child of node.children) collect(child, selected);
          }
        };
        for (const n of st.doc.layers) collect(n, false);
        if (minX !== Infinity) setViewport(fitBounds(v2(minX, minY), v2(maxX, maxY), rect.width, rect.height, 60));
      }
    };
    window.addEventListener("lambert-zoom", onZoom);
    return () => window.removeEventListener("lambert-zoom", onZoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docW, docH]);

  // Wheel-zoom via a NATIVE non-passive listener: preventDefault stops Electron's page zoom
  // (Ctrl+wheel / trackpad pinch) from firing underneath the canvas zoom, and stopPropagation keeps
  // zoom-scroll out of the surrounding layout.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const rect = host.getBoundingClientRect();
      setViewport((vp) => zoomAt(vp, v2(e.clientX - rect.left, e.clientY - rect.top), e.deltaY < 0 ? 1.2 : 1 / 1.2));
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { viewport, setViewport };
}
