import type { LambertDoc } from "./schema";
import type { CanvasState } from "../field/types";

type Guide = CanvasState["guides"][number];

/** Append a guide to the canvas. */
export function addGuide(doc: LambertDoc, guide: Guide): LambertDoc {
  return { ...doc, canvas: { ...doc.canvas, guides: [...doc.canvas.guides, guide] } };
}

/** Move the guide at `index` to a new position (doc px along its cross axis). */
export function moveGuide(doc: LambertDoc, index: number, at: number): LambertDoc {
  const guides = doc.canvas.guides.map((g, i) => (i === index ? { ...g, at } : g));
  return { ...doc, canvas: { ...doc.canvas, guides } };
}

/** Remove the guide at `index`. */
export function removeGuide(doc: LambertDoc, index: number): LambertDoc {
  return { ...doc, canvas: { ...doc.canvas, guides: doc.canvas.guides.filter((_, i) => i !== index) } };
}

/** Remove every guide. */
export function clearGuides(doc: LambertDoc): LambertDoc {
  return { ...doc, canvas: { ...doc.canvas, guides: [] } };
}
