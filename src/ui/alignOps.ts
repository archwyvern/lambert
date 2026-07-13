import { Vector2 } from "../math";
import { affineApply, affineInvert } from "../field/affine";
import { flattenLayers } from "../field/flatten";
import { isGroup, isObject, type LayerNode, type ObjectInstance } from "../field/types";
import { v2 } from "../field/vec";
import { findNode, findParentId, nodeWorldAffine, updateNode } from "../document/layerOps";
import { localBounds } from "../field/objectBounds";

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeAxis = "h" | "v";

interface Box {
  id: string;
  min: Vector2;
  max: Vector2;
}

/** The world-space AABB of a node: an object = its footprint; a group = the union of its object
 *  descendants' footprints. Null if the node has no object geometry (e.g. an empty group). */
function worldBox(layers: LayerNode[], id: string): Box | null {
  const node = findNode(layers, id);
  if (!node) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const addObject = (obj: ObjectInstance): void => {
    const aff = nodeWorldAffine(layers, obj.id);
    if (!aff) return;
    const lb = localBounds(obj);
    for (const c of [v2(lb.min.x, lb.min.y), v2(lb.max.x, lb.min.y), v2(lb.max.x, lb.max.y), v2(lb.min.x, lb.max.y)]) {
      const w = affineApply(aff, c);
      minX = Math.min(minX, w.x);
      minY = Math.min(minY, w.y);
      maxX = Math.max(maxX, w.x);
      maxY = Math.max(maxY, w.y);
    }
  };
  const walk = (n: LayerNode): void => {
    if (isObject(n)) addObject(n);
    else if (isGroup(n)) n.children.forEach(walk);
  };
  walk(node);
  if (minX === Infinity) return null;
  return { id, min: v2(minX, minY), max: v2(maxX, maxY) };
}

/** Translate a node by a WORLD delta, converting to a parent-local pos delta through the parent's inverse
 *  linear (same convention as the multi-select move drag). Top-level nodes translate directly. */
function translateWorld(layers: LayerNode[], id: string, wdx: number, wdy: number): LayerNode[] {
  if (wdx === 0 && wdy === 0) return layers;
  const parentId = findParentId(layers, id);
  const pAff = parentId ? nodeWorldAffine(layers, parentId) : null;
  const inv = pAff ? affineInvert(pAff) : null;
  const ldx = inv ? inv.a * wdx + inv.b * wdy : wdx;
  const ldy = inv ? inv.c * wdx + inv.d * wdy : wdy;
  return updateNode(layers, id, (n) => ({
    ...n,
    transform: { ...n.transform, pos: n.transform.pos.withX(n.transform.pos.x + ldx).withY(n.transform.pos.y + ldy) },
  }));
}

const cx = (b: Box): number => (b.min.x + b.max.x) / 2;
const cy = (b: Box): number => (b.min.y + b.max.y) / 2;

/** Align every selected node's footprint to a shared edge/centre (relative to the selection's union box).
 *  Needs 2+ nodes with geometry; otherwise a no-op. */
export function alignNodes(layers: LayerNode[], ids: string[], mode: AlignMode): LayerNode[] {
  const boxes = ids.map((id) => worldBox(layers, id)).filter((b): b is Box => b !== null);
  if (boxes.length < 2) return layers;
  const unionMinX = Math.min(...boxes.map((b) => b.min.x));
  const unionMaxX = Math.max(...boxes.map((b) => b.max.x));
  const unionMinY = Math.min(...boxes.map((b) => b.min.y));
  const unionMaxY = Math.max(...boxes.map((b) => b.max.y));
  const unionCX = (unionMinX + unionMaxX) / 2;
  const unionCY = (unionMinY + unionMaxY) / 2;
  let out = layers;
  for (const b of boxes) {
    let wdx = 0;
    let wdy = 0;
    if (mode === "left") wdx = unionMinX - b.min.x;
    else if (mode === "right") wdx = unionMaxX - b.max.x;
    else if (mode === "hcenter") wdx = unionCX - cx(b);
    else if (mode === "top") wdy = unionMinY - b.min.y;
    else if (mode === "bottom") wdy = unionMaxY - b.max.y;
    else if (mode === "vcenter") wdy = unionCY - cy(b);
    out = translateWorld(out, b.id, wdx, wdy);
  }
  return out;
}

/** Evenly space the selected nodes' centres along an axis between the two extreme nodes (which stay put).
 *  Needs 3+ nodes with geometry; otherwise a no-op. */
export function distributeNodes(layers: LayerNode[], ids: string[], axis: DistributeAxis): LayerNode[] {
  const boxes = ids.map((id) => worldBox(layers, id)).filter((b): b is Box => b !== null);
  if (boxes.length < 3) return layers;
  const center = axis === "h" ? cx : cy;
  const sorted = [...boxes].sort((a, b) => center(a) - center(b));
  const first = center(sorted[0]!);
  const last = center(sorted[sorted.length - 1]!);
  const step = (last - first) / (sorted.length - 1);
  let out = layers;
  sorted.forEach((b, i) => {
    if (i === 0 || i === sorted.length - 1) return; // the extremes anchor the spread
    const delta = first + step * i - center(b);
    out = translateWorld(out, b.id, axis === "h" ? delta : 0, axis === "h" ? 0 : delta);
  });
  return out;
}
