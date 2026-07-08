import { describe, expect, it } from "vitest";
import "../../src/field/objects";
import { addInstanceNear } from "../../src/document/docOps";
import { emptyDoc } from "../../src/document/schema";
import { findNode, findParentId, nodeWorldComposite, wrapInGroup } from "../../src/document/layerOps";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import { isObject, type LayerNode, type ObjectInstance } from "../../src/field/types";
import { v2 } from "../../src/field/vec";

const objectAt = (id: string, x = 0, y = 0): ObjectInstance => {
  const s = createObjectInstance(ObjectTypeId.Sphere, v2(x, y));
  s.id = id;
  return s;
};

function docWithGroup(): { doc: ReturnType<typeof emptyDoc>; layers: LayerNode[] } {
  const doc = emptyDoc("file:///a.df.png", 64, 64);
  let layers: LayerNode[] = [objectAt("loose"), objectAt("member", 10, 10)];
  layers = wrapInGroup(layers, ["member"], "g1");
  return { doc: { ...doc, layers }, layers };
}

describe("addInstanceNear", () => {
  it("no selection -> top level", () => {
    const { doc } = docWithGroup();
    const out = addInstanceNear(doc, objectAt("fresh"), null);
    expect(findParentId(out.layers, "fresh")).toBe(null);
  });

  it("a selected top-level object -> top level (its 'group' is the root)", () => {
    const { doc } = docWithGroup();
    const out = addInstanceNear(doc, objectAt("fresh"), "loose");
    expect(findParentId(out.layers, "fresh")).toBe(null);
  });

  it("a selected GROUP receives the new object", () => {
    const { doc } = docWithGroup();
    const out = addInstanceNear(doc, objectAt("fresh"), "g1");
    expect(findParentId(out.layers, "fresh")).toBe("g1");
  });

  it("a selected object INSIDE a group puts the new object in that group", () => {
    const { doc } = docWithGroup();
    const out = addInstanceNear(doc, objectAt("fresh"), "member");
    expect(findParentId(out.layers, "fresh")).toBe("g1");
  });

  it("the instance's WORLD placement survives insertion into a transformed group", () => {
    const doc = emptyDoc("file:///a.df.png", 64, 64);
    let layers: LayerNode[] = [objectAt("member", 10, 10)];
    layers = wrapInGroup(layers, ["member"], "g1", { x: 0, y: 0 });
    // shove the group somewhere else so the rebase has real work to do
    const g = findNode(layers, "g1")!;
    g.transform.pos = g.transform.pos.withX(40).withY(-25);
    const out = addInstanceNear({ ...doc, layers }, objectAt("fresh", 5, 7), "member");
    expect(findParentId(out.layers, "fresh")).toBe("g1");
    const world = nodeWorldComposite(out.layers, "fresh")!;
    const node = findNode(out.layers, "fresh")!;
    expect(isObject(node)).toBe(true);
    // world position is still (5,7) — the caller's placement, not group-local drift
    expect(world.affine.e).toBeCloseTo(5, 5);
    expect(world.affine.f).toBeCloseTo(7, 5);
  });
});
