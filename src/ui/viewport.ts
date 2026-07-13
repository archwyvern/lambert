import { Vector2 } from "@carapace/primitives";
import { v2 } from "../field/vec";

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 16;

export const canvasToScreen = (v: Viewport, p: Vector2): Vector2 => v2(p.x * v.zoom + v.panX, p.y * v.zoom + v.panY);

export const screenToCanvas = (v: Viewport, p: Vector2): Vector2 => v2((p.x - v.panX) / v.zoom, (p.y - v.panY) / v.zoom);

/** Zoom by factor keeping the screen-space anchor over the same canvas point. */
export function zoomAt(v: Viewport, anchor: Vector2, factor: number): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  const c = screenToCanvas(v, anchor);
  return { zoom, panX: anchor.x - c.x * zoom, panY: anchor.y - c.y * zoom };
}

/** Fit a WORLD-space bounds box (min..max) into the view, centred, with a screen-px margin. Used by
 *  fit-to-selection (fitViewport is the doc-origin special case). */
export function fitBounds(min: Vector2, max: Vector2, viewW: number, viewH: number, margin: number): Viewport {
  const bw = Math.max(1, max.x - min.x);
  const bh = Math.max(1, max.y - min.y);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((viewW - 2 * margin) / bw, (viewH - 2 * margin) / bh)));
  return { zoom, panX: (viewW - bw * zoom) / 2 - min.x * zoom, panY: (viewH - bh * zoom) / 2 - min.y * zoom };
}

/** Initial fit: zoom that fits doc+margin into the view, centered. */
export function fitViewport(docW: number, docH: number, viewW: number, viewH: number, margin: number): Viewport {
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min((viewW - 2 * margin) / docW, (viewH - 2 * margin) / docH)),
  );
  return { zoom, panX: (viewW - docW * zoom) / 2, panY: (viewH - docH * zoom) / 2 };
}
