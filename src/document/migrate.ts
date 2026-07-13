import { Vector3 } from "../math";
import type { BezierAnchor } from "../field/bezier";
import type { LayerNode, Mask } from "../field/types";
import { v2 } from "../field/vec";
import type { LambertDoc } from "./schema";

export type ResizeMode = "adopt" | "scale";

/**
 * Migrate a document to a diffuse that changed size, instead of refusing to open it.
 *
 * - `adopt`: take the new canvas dims; objects keep their ABSOLUTE positions (artwork was extended
 *   or cropped — e.g. more sprite added below, everything authored stays put).
 * - `scale`: the artwork itself was resized — scale everything with the canvas: top-level node
 *   positions and scales, world-space (non-follow) mask outlines, the origin, and the guides.
 *   Object-LOCAL geometry (control points, paths, follow masks) rides on the node scale. Under
 *   non-uniform factors a rotated object's scale is approximated per-axis (exact for the common
 *   uniform / unrotated cases).
 */
export function migrateDocToDims(doc: LambertDoc, width: number, height: number, mode: ResizeMode): LambertDoc {
  const source = { ...doc.source, width, height };
  if (mode === "adopt") return { ...doc, source };
  const fx = width / doc.source.width;
  const fy = height / doc.source.height;
  const scaleAnchor = (a: BezierAnchor): BezierAnchor => ({
    ...a,
    p: v2(a.p.x * fx, a.p.y * fy),
    hIn: v2(a.hIn.x * fx, a.hIn.y * fy),
    hOut: v2(a.hOut.x * fx, a.hOut.y * fy),
  });
  const scaleMask = (m: Mask): Mask => (m.follow ? m : { ...m, anchors: m.anchors.map(scaleAnchor) });
  const scaleNode = (n: LayerNode): LayerNode => ({
    ...n,
    transform: {
      ...n.transform,
      pos: new Vector3(n.transform.pos.x * fx, n.transform.pos.y * fy, n.transform.pos.z),
      scale: new Vector3(n.transform.scale.x * fx, n.transform.scale.y * fy, n.transform.scale.z),
    },
    masks: n.masks?.map(scaleMask),
  });
  return {
    ...doc,
    source,
    layers: doc.layers.map(scaleNode), // top level only: children inherit their parent's transform
    canvas: {
      ...doc.canvas,
      origin: { x: doc.canvas.origin.x * fx, y: doc.canvas.origin.y * fy },
      guides: doc.canvas.guides.map((g) => ({ ...g, at: g.at * (g.orient === "v" ? fx : fy) })),
    },
  };
}
