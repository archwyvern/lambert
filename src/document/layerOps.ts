import { Vector3 } from "@carapace/primitives";
import { affineCompose, affineFromTRS, affineIdentity, affineInvert, type Affine } from "../field/affine";
import { isGroup, type GroupLayer, type LayerNode } from "../field/types";
import { identityTransform } from "../field/transform";
import { cloneObject } from "./docOps";

/** Find a node by id anywhere in the tree. */
export function findNode(layers: LayerNode[], id: string): LayerNode | null {
  for (const n of layers) {
    if (n.id === id) return n;
    if (isGroup(n)) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

/** A node's fully-composed world transform: the 2D affine plus the z chain (elevation = sum of pos.z,
 *  tallness = product of scale.z). Excludes mirror (authoring/picking use the base frame). */
export interface WorldComposite {
  affine: Affine;
  elevation: number;
  tallness: number;
}

const WORLD_ROOT: WorldComposite = { affine: affineIdentity(), elevation: 0, tallness: 1 };

/** Compose a node's world transform from its ancestor chain + its own transform. null if not found. */
export function nodeWorldComposite(layers: LayerNode[], id: string): WorldComposite | null {
  const visit = (nodes: LayerNode[], acc: WorldComposite): WorldComposite | null => {
    for (const n of nodes) {
      const cur: WorldComposite = {
        affine: affineCompose(acc.affine, affineFromTRS(n.transform)),
        elevation: acc.elevation + n.transform.pos.z,
        tallness: acc.tallness * n.transform.scale.z,
      };
      if (n.id === id) return cur;
      if (isGroup(n)) {
        const r = visit(n.children, cur);
        if (r) return r;
      }
    }
    return null;
  };
  return visit(layers, WORLD_ROOT);
}

/** A node's world affine (local -> world): every ancestor group's transform composed with its own.
 *  Excludes mirror (authoring/picking happen in the base, unmirrored frame). null if not found. */
export function nodeWorldAffine(layers: LayerNode[], id: string): Affine | null {
  return nodeWorldComposite(layers, id)?.affine ?? null;
}

export interface NodeFrames {
  /** World affine of the node's PARENT (identity for a top-level node) — where the node's local TRS
   *  edits live. */
  parentAffine: Affine;
  invParent: Affine;
  /** Full local->world affine of the node (= parentAffine ∘ affineFromTRS(node.transform)). */
  worldAffine: Affine;
  invWorld: Affine;
}

/** Parent + world affine frames (and their inverses) for a node — the boilerplate the three gizmos
 *  each derived by hand (parentId -> nodeWorldAffine -> compose -> invert). */
export function nodeFrames(layers: LayerNode[], id: string): NodeFrames {
  const parentId = findParentId(layers, id);
  const parentAffine = parentId ? (nodeWorldAffine(layers, parentId) ?? affineIdentity()) : affineIdentity();
  const worldAffine = nodeWorldAffine(layers, id) ?? affineIdentity();
  return { parentAffine, invParent: affineInvert(parentAffine), worldAffine, invWorld: affineInvert(worldAffine) };
}

/** The id of a node's parent group, or null if it's top-level, or undefined if not found. */
export function findParentId(layers: LayerNode[], id: string): string | null | undefined {
  const rec = (arr: LayerNode[], parent: string | null): string | null | undefined => {
    for (const n of arr) {
      if (n.id === id) return parent;
      if (isGroup(n)) {
        const f = rec(n.children, n.id);
        if (f !== undefined) return f;
      }
    }
    return undefined;
  };
  return rec(layers, null);
}

/** The sibling list a node lives in (its parent's children, or the top level). */
export function siblingsOf(layers: LayerNode[], id: string): LayerNode[] {
  const parent = findParentId(layers, id);
  if (parent === undefined) return layers;
  if (parent === null) return layers;
  const p = findNode(layers, parent);
  return p && isGroup(p) ? p.children : layers;
}

/** Replace the node with id by patch(node), preserving tree structure. */
export function updateNode(layers: LayerNode[], id: string, patch: (n: LayerNode) => LayerNode): LayerNode[] {
  return layers.map((n) => {
    if (n.id === id) return patch(n);
    if (isGroup(n)) return { ...n, children: updateNode(n.children, id, patch) };
    return n;
  });
}

/** Remove the node with id (and its subtree) from the tree. */
export function removeNode(layers: LayerNode[], id: string): LayerNode[] {
  const out: LayerNode[] = [];
  for (const n of layers) {
    if (n.id === id) continue;
    out.push(isGroup(n) ? { ...n, children: removeNode(n.children, id) } : n);
  }
  return out;
}

/** True if `descId` is inside the subtree rooted at `ancestorId` (or is it). */
function inSubtree(layers: LayerNode[], ancestorId: string, descId: string): boolean {
  if (ancestorId === descId) return true;
  const node = findNode(layers, ancestorId);
  return !!(node && isGroup(node) && findNode(node.children, descId));
}

/** Insert a node into a parent group (parentId null = top level) at index (default end). */
export function addNode(layers: LayerNode[], node: LayerNode, parentId: string | null, index?: number): LayerNode[] {
  if (parentId === null) {
    const out = layers.slice();
    out.splice(index ?? out.length, 0, node);
    return out;
  }
  return updateNode(layers, parentId, (p) => {
    if (!isGroup(p)) return p;
    const children = p.children.slice();
    children.splice(index ?? children.length, 0, node);
    return { ...p, children };
  });
}

/** Rebase a node's local transform so its WORLD transform is unchanged under a new parent: with the
 *  new parent's world frame P and the node's current world frame W, the new local = P⁻¹ · W (z chain
 *  rebased too). Returns the node unchanged if the result would shear (non-uniform parent + rotated
 *  node) — a TRS can't hold shear, so the reparent still happens but the node visually shifts. */
function rebaseForParent(layers: LayerNode[], node: LayerNode, targetParentId: string | null): LayerNode {
  const world = nodeWorldComposite(layers, node.id);
  if (!world) return node;
  const parent = targetParentId === null ? WORLD_ROOT : nodeWorldComposite(layers, targetParentId);
  if (!parent) return node;
  const trs = decomposeAffine(affineCompose(affineInvert(parent.affine), world.affine));
  if (!trs) return node;
  const sz = parent.tallness === 0 ? node.transform.scale.z : world.tallness / parent.tallness;
  return {
    ...node,
    transform: {
      pos: new Vector3(trs.px, trs.py, world.elevation - parent.elevation),
      rotation: trs.rotation,
      scale: new Vector3(trs.sx, trs.sy, sz),
    },
  };
}

/** Move a node to a new parent (null = top level) at index. Refuses to move a group into its own
 *  subtree (would create a cycle) — returns the tree unchanged. When the parent actually changes the
 *  node's local transform is rebased so its world transform is preserved (no visual jump). */
export function moveNode(layers: LayerNode[], id: string, targetParentId: string | null, index: number): LayerNode[] {
  if (targetParentId !== null && inSubtree(layers, id, targetParentId)) return layers;
  const node = findNode(layers, id);
  if (!node) return layers;
  // only rebase across an actual parent change; a same-parent reorder keeps the transform verbatim
  const reparenting = (findParentId(layers, id) ?? null) !== targetParentId;
  const moved = reparenting ? rebaseForParent(layers, node, targetParentId) : node;
  return addNode(removeNode(layers, id), moved, targetParentId, index);
}

/** Wrap the given nodes in a new group whose local origin sits at `pos` (the canvas origin, so group
 *  symmetry mirrors about it), preserving each member's WORLD transform (members pulled out of other
 *  groups get their world frame baked into the new group's frame, so nothing visually moves). Children
 *  keep document (z) order; the group is placed at the shallowest member's top-level slot. */
export function wrapInGroup(layers: LayerNode[], ids: string[], groupId: string, pos: { x: number; y: number } = { x: 0, y: 0 }, name?: string): LayerNode[] {
  const present = ids.filter((id) => findNode(layers, id));
  if (present.length === 0) return layers;
  // order members by document (DFS) order so the group preserves their relative stacking
  const orderIndex = new Map<string, number>();
  let k = 0;
  const indexWalk = (nodes: LayerNode[]): void => {
    for (const n of nodes) {
      orderIndex.set(n.id, k++);
      if (isGroup(n)) indexWalk(n.children);
    }
  };
  indexWalk(layers);
  const ordered = [...present].sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  // the new group sits at `pos` with identity rotation/scale; bake each member relative to that frame
  const groupTransform = { pos: new Vector3(pos.x, pos.y, 0), rotation: 0, scale: new Vector3(1, 1, 1) };
  const invGroup = affineInvert(affineFromTRS(groupTransform));
  const children = ordered.map((id) => {
    const node = findNode(layers, id)!;
    const w = nodeWorldComposite(layers, id)!;
    const trs = decomposeAffine(affineCompose(invGroup, w.affine));
    if (!trs) return node; // sheared world frame (nested under non-uniform + rotated): keep local
    return {
      ...node,
      transform: { pos: new Vector3(trs.px, trs.py, w.elevation), rotation: trs.rotation, scale: new Vector3(trs.sx, trs.sy, w.tallness) },
    };
  });
  const topIdx = layers.findIndex((n) => present.includes(n.id));
  let next = layers;
  for (const id of present) next = removeNode(next, id);
  const group: GroupLayer = { kind: "group", id: groupId, name, transform: groupTransform, visible: true, locked: false, children };
  return addNode(next, group, null, topIdx >= 0 ? topIdx : undefined);
}

/** Add an empty group at the top level (end). */
export function addGroup(layers: LayerNode[], group: GroupLayer): LayerNode[] {
  return [...layers, group];
}

/** Decompose a 2x3 affine into a TRS, or null if it shears (columns not orthogonal) — a loose node
 *  can't hold a sheared transform, so ungroup of such a child is refused. */
function decomposeAffine(m: Affine): { px: number; py: number; rotation: number; sx: number; sy: number } | null {
  const sx = Math.hypot(m.a, m.c);
  if (sx < 1e-9) return null;
  const det = m.a * m.d - m.b * m.c;
  const sy = det / sx;
  const shear = (m.a * m.b + m.c * m.d) / (sx * sx);
  if (Math.abs(shear) > 1e-5) return null; // sheared: not representable as a loose TRS
  return { px: m.e, py: m.f, rotation: Math.atan2(m.c, m.a), sx, sy };
}

/** Dissolve a group: splice its children into the parent at the group's slot, baking the group's
 *  transform into each child so nothing visually moves. Returns null if any child would shear
 *  (non-uniform group + rotated child) — the caller should keep the group and warn. */
export function ungroup(layers: LayerNode[], id: string): LayerNode[] | null {
  const g = findNode(layers, id);
  if (!g || !isGroup(g)) return layers;
  const gAffine = affineFromTRS(g.transform);
  const baked: LayerNode[] = [];
  for (const child of g.children) {
    const trs = decomposeAffine(affineCompose(gAffine, affineFromTRS(child.transform)));
    if (!trs) return null;
    const transform = {
      pos: new Vector3(trs.px, trs.py, g.transform.pos.z + child.transform.pos.z),
      rotation: trs.rotation,
      scale: new Vector3(trs.sx, trs.sy, g.transform.scale.z * child.transform.scale.z),
    };
    baked.push({ ...child, transform });
  }
  return spliceReplace(layers, id, baked);
}

/** Replace the single node `id` with the list `replacement` wherever it sits in the tree. */
function spliceReplace(layers: LayerNode[], id: string, replacement: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  for (const n of layers) {
    if (n.id === id) {
      out.push(...replacement);
    } else if (isGroup(n)) {
      out.push({ ...n, children: spliceReplace(n.children, id, replacement) });
    } else {
      out.push(n);
    }
  }
  return out;
}

/** Deep-clone a node with fresh ids. The top node is offset by (dx,dy); descendants are not. */
function cloneNode(n: LayerNode, dx: number, dy: number): LayerNode {
  if (isGroup(n)) {
    return {
      ...n,
      id: crypto.randomUUID(),
      transform: {
        pos: new Vector3(n.transform.pos.x + dx, n.transform.pos.y + dy, n.transform.pos.z),
        rotation: n.transform.rotation,
        scale: n.transform.scale,
      },
      masks: n.masks?.map((m) => ({ ...m, anchors: m.anchors.map((a) => ({ ...a })) })),
      children: n.children.map((c) => cloneNode(c, 0, 0)),
    };
  }
  return cloneObject(n, dx, dy);
}

/** Duplicate a node (deep, fresh ids), inserting the copy right after the original in the same parent.
 *  Returns the new tree and the copy's id. */
export function duplicateNode(layers: LayerNode[], id: string): { layers: LayerNode[]; newId: string } {
  const node = findNode(layers, id);
  if (!node) return { layers, newId: id };
  const copy = cloneNode(node, 0, 0); // identical position — an exact copy stacked on the original
  return { layers: insertAfter(layers, id, copy), newId: copy.id };
}

function insertAfter(layers: LayerNode[], id: string, node: LayerNode): LayerNode[] {
  const out: LayerNode[] = [];
  for (const n of layers) {
    out.push(isGroup(n) ? { ...n, children: insertAfter(n.children, id, node) } : n);
    if (n.id === id) out.push(node);
  }
  return out;
}

/** A fresh empty group at an identity transform (UI helper). */
export function emptyGroup(id: string, name?: string): GroupLayer {
  return { kind: "group", id, name, transform: identityTransform(), visible: true, locked: false, children: [] };
}
