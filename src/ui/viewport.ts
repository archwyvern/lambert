import type { Vec2 } from "../field/vec";

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 16;

export const canvasToScreen = (v: Viewport, p: Vec2): Vec2 => ({
  x: p.x * v.zoom + v.panX,
  y: p.y * v.zoom + v.panY,
});

export const screenToCanvas = (v: Viewport, p: Vec2): Vec2 => ({
  x: (p.x - v.panX) / v.zoom,
  y: (p.y - v.panY) / v.zoom,
});

/** Zoom by factor keeping the screen-space anchor over the same canvas point. */
export function zoomAt(v: Viewport, anchor: Vec2, factor: number): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  const c = screenToCanvas(v, anchor);
  return { zoom, panX: anchor.x - c.x * zoom, panY: anchor.y - c.y * zoom };
}

/** Initial fit: zoom that fits doc+margin into the view, centered. */
export function fitViewport(docW: number, docH: number, viewW: number, viewH: number, margin: number): Viewport {
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min((viewW - 2 * margin) / docW, (viewH - 2 * margin) / docH)),
  );
  return { zoom, panX: (viewW - docW * zoom) / 2, panY: (viewH - docH * zoom) / 2 };
}
