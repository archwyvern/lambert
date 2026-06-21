import { describe, expect, it } from "vitest";
import { Vector2, Vector3 } from "@carapace/primitives";
import "../../src/field/shapes";
import { addNode, duplicateNode, emptyGroup, findNode, findParentId, moveNode, nodeWorldComposite, ungroup, wrapInGroup } from "../../src/document/layerOps";
import { affineApply } from "../../src/field/affine";
import { createShapeInstance } from "../../src/field/registry";
import { isGroup, type GroupLayer, type LayerNode } from "../../src/field/types";
import { v2 } from "../../src/field/vec";

const shapeAt = (id: string, x = 0, y = 0): LayerNode => {
  const s = createShapeInstance("dome", v2(x, y));
  s.id = id;
  return s;
};
const ids = (layers: LayerNode[]): string[] => layers.map((n) => n.id);

describe("layerOps", () => {
  it("wrapInGroup nests the node in a new group at its slot; findParentId tracks it", () => {
    const layers: LayerNode[] = [shapeAt("a"), shapeAt("b"), shapeAt("c")];
    const out = wrapInGroup(layers, ["b"], "g1");
    expect(ids(out)).toEqual(["a", "g1", "c"]); // group took b's slot
    const g = findNode(out, "g1")!;
    expect(isGroup(g)).toBe(true);
    expect((g as GroupLayer).children.map((n) => n.id)).toEqual(["b"]);
    expect(findParentId(out, "b")).toBe("g1");
    expect(findParentId(out, "a")).toBe(null);
    expect(findParentId(out, "missing")).toBeUndefined();
  });

  it("wrapInGroup places the group at the given origin and bakes children so they stay put", () => {
    const a = shapeAt("a", 80, 60);
    const b = shapeAt("b", 20, 30);
    const layers: LayerNode[] = [a, b];
    const before = { a: nodeWorldComposite(layers, "a")!, b: nodeWorldComposite(layers, "b")! };
    const out = wrapInGroup(layers, ["a", "b"], "g", { x: 50, y: 50 }); // origin at texture centre
    const g = findNode(out, "g") as GroupLayer;
    expect(g.transform.pos.x).toBe(50); // group's local origin sits on the canvas origin
    expect(g.transform.pos.y).toBe(50);
    // children unchanged in world space
    for (const id of ["a", "b"] as const) {
      const w = nodeWorldComposite(out, id)!;
      expect(affineApply(w.affine, v2(0, 0)).x).toBeCloseTo(affineApply(before[id].affine, v2(0, 0)).x, 4);
      expect(affineApply(w.affine, v2(0, 0)).y).toBeCloseTo(affineApply(before[id].affine, v2(0, 0)).y, 4);
    }
    // a child's local pos is now relative to the origin (80,60) - (50,50) = (30,10)
    const baked = (findNode(out, "a") as { transform: { pos: Vector3 } }).transform.pos;
    expect(baked.x).toBeCloseTo(30);
    expect(baked.y).toBeCloseTo(10);
  });

  it("moveNode reparents, and refuses to move a group into its own descendant", () => {
    const inner = shapeAt("x");
    const g: GroupLayer = { ...emptyGroup("g"), children: [inner] };
    const layers: LayerNode[] = [g, shapeAt("a")];
    // move a into g
    const m = moveNode(layers, "a", "g", 1);
    expect((findNode(m, "g") as GroupLayer).children.map((n) => n.id)).toEqual(["x", "a"]);
    // cycle guard: moving g into its own child x is a no-op
    expect(moveNode(layers, "g", "g", 0)).toBe(layers); // into itself
    const nested: GroupLayer = { ...emptyGroup("outer"), children: [{ ...emptyGroup("innerG"), children: [] }] };
    expect(moveNode([nested], "outer", "innerG", 0)).toEqual([nested]); // into descendant -> unchanged
  });

  it("ungroup bakes the group transform into children (uniform scale, no shear)", () => {
    const child = shapeAt("c", 5, 0);
    const g: GroupLayer = {
      kind: "group",
      id: "g",
      transform: { pos: new Vector3(100, 0, 2), rotation: 0, scale: new Vector3(2, 2, 3) },
      visible: true,
      locked: false,
      children: [child],
    };
    const out = ungroup([g], "g");
    expect(out).not.toBeNull();
    const baked = findNode(out!, "c")!;
    // child local (5,0) scaled 2 + 100 = world x 110; z elevation 0+2, tallness 1*3
    expect((baked as { transform: { pos: Vector3 } }).transform.pos.x).toBeCloseTo(110);
    expect((baked as { transform: { pos: Vector3 } }).transform.pos.z).toBeCloseTo(2);
    expect((baked as { transform: { scale: Vector3 } }).transform.scale.x).toBeCloseTo(2);
    expect((baked as { transform: { scale: Vector3 } }).transform.scale.z).toBeCloseTo(3);
  });

  it("ungroup returns null when a child would shear (non-uniform group + rotated child)", () => {
    const child = shapeAt("c");
    child.transform.rotation = 0.6;
    const g: GroupLayer = {
      kind: "group",
      id: "g",
      transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(2, 0.5, 1) }, // non-uniform
      visible: true,
      locked: false,
      children: [child],
    };
    expect(ungroup([g], "g")).toBeNull();
  });

  it("moveNode INTO a group preserves the node's world transform (rebases the local)", () => {
    const a = shapeAt("a", 100, 50);
    a.transform.rotation = 0.3;
    a.transform.scale = new Vector3(1.5, 1.5, 2);
    a.transform.pos = a.transform.pos.withZ(4);
    const g: GroupLayer = {
      kind: "group",
      id: "g",
      transform: { pos: new Vector3(30, 20, 3), rotation: 0.4, scale: new Vector3(2, 2, 1.5) },
      visible: true,
      locked: false,
      children: [],
    };
    const layers: LayerNode[] = [g, a];
    const before = nodeWorldComposite(layers, "a")!;
    const out = moveNode(layers, "a", "g", 0);
    expect(findParentId(out, "a")).toBe("g"); // actually reparented
    const after = nodeWorldComposite(out, "a")!;
    // world affine, elevation and tallness all unchanged
    for (const p of [v2(0, 0), v2(10, -7)]) {
      expect(affineApply(after.affine, p).x).toBeCloseTo(affineApply(before.affine, p).x, 4);
      expect(affineApply(after.affine, p).y).toBeCloseTo(affineApply(before.affine, p).y, 4);
    }
    expect(after.elevation).toBeCloseTo(before.elevation, 4);
    expect(after.tallness).toBeCloseTo(before.tallness, 4);
  });

  it("moveNode OUT of a group to top level also preserves the world transform", () => {
    const child = shapeAt("c", 8, 0);
    const g: GroupLayer = {
      kind: "group",
      id: "g",
      transform: { pos: new Vector3(40, 10, 2), rotation: 0.2, scale: new Vector3(1.5, 1.5, 2) },
      visible: true,
      locked: false,
      children: [child],
    };
    const layers: LayerNode[] = [g];
    const before = nodeWorldComposite(layers, "c")!;
    const out = moveNode(layers, "c", null, 1);
    expect(findParentId(out, "c")).toBe(null);
    const after = nodeWorldComposite(out, "c")!;
    expect(affineApply(after.affine, v2(0, 0)).x).toBeCloseTo(affineApply(before.affine, v2(0, 0)).x, 4);
    expect(affineApply(after.affine, v2(0, 0)).y).toBeCloseTo(affineApply(before.affine, v2(0, 0)).y, 4);
    expect(after.elevation).toBeCloseTo(before.elevation, 4);
    expect(after.tallness).toBeCloseTo(before.tallness, 4);
  });

  it("a same-parent reorder keeps the transform verbatim (no rebase drift)", () => {
    const layers: LayerNode[] = [shapeAt("a", 5, 5), shapeAt("b", 9, 9)];
    const moved = moveNode(layers, "b", null, 0);
    const b = findNode(moved, "b")!;
    expect((b as { transform: { pos: Vector3 } }).transform.pos.x).toBe(9); // unchanged exactly
  });

  it("duplicateNode deep-copies a subtree with fresh ids, inserted after the original", () => {
    const g: GroupLayer = { ...emptyGroup("g"), children: [shapeAt("x"), shapeAt("y")] };
    const layers: LayerNode[] = [g, shapeAt("a")];
    const { layers: out, newId } = duplicateNode(layers, "g");
    expect(out.length).toBe(3);
    expect(out[1]!.id).toBe(newId); // copy right after the original
    expect(newId).not.toBe("g");
    const copy = findNode(out, newId) as GroupLayer;
    expect(copy.children.length).toBe(2);
    expect(copy.children.map((n) => n.id)).not.toEqual(["x", "y"]); // fresh child ids
  });

  it("addNode inserts at top level or into a group", () => {
    const layers: LayerNode[] = [emptyGroup("g")];
    const t = addNode(layers, shapeAt("a"), "g");
    expect((findNode(t, "g") as GroupLayer).children.map((n) => n.id)).toEqual(["a"]);
    const u = addNode(layers, shapeAt("b"), null, 0);
    expect(ids(u)).toEqual(["b", "g"]);
  });
});
