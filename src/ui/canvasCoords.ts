import { Vector2 } from "@aphralatrax/primitives";
import { v2 } from "../field/vec";
import { screenToCanvas, Viewport } from "./viewport";

/** Mouse/pointer event -> canvas-space point, via the event's owning <svg> rect. The three gizmos
 *  each used to inline this ownerSVGElement + getBoundingClientRect + screenToCanvas block. */
export function eventToCanvas(e: { currentTarget: Element; clientX: number; clientY: number }, viewport: Viewport): Vector2 {
  const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement!;
  const rect = svg.getBoundingClientRect();
  return screenToCanvas(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
}
