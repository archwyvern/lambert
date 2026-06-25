import { describe, expect, it } from "vitest";
import { Vector2, Vector3 } from "@carapace/primitives";
import "../../src/field/objects";
import { flattenLayers, resolveObjects } from "../../src/field/flatten";
import { affineApply, affineFromTRS } from "../../src/field/affine";
import { createMask } from "../../src/field/maskOps";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import { fromLocal } from "../../src/field/transform";
import type { GroupLayer, Mask } from "../../src/field/types";

const v = (x: number, y: number): Vector2 => new Vector2(x, y);

/** A group wrapping `children`, with optional masks + mirror, default identity transform. */
function group(children: GroupLayer["children"], extra: Partial<GroupLayer> = {}): GroupLayer {
  return {
    kind: "group",
    id: "g",
    transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
    visible: true,
    locked: false,
    children,
    ...extra,
  };
}
const keepSquare = (cx: number, cy: number, r: number): Mask =>
  createMask([v(cx - r, cy - r), v(cx + r, cy - r), v(cx + r, cy + r), v(cx - r, cy + r)], true);

describe("flattenLayers", () => {
  it("a lone object resolves to its own transform", () => {
    const s = createObjectInstance(ObjectTypeId.Sphere, v(10, 20));
    s.transform.scale = new Vector3(2, 3, 1);
    const [rs] = flattenLayers([s]);
    const worldOrigin = fromLocal(s.transform, v(0, 0));
    const back = affineApply(rs!.invAffine, worldOrigin);
    expect(back.x).toBeCloseTo(0, 5);
    expect(back.y).toBeCloseTo(0, 5);
    expect(rs!.tallnessZ).toBe(1);
  });

  it("a group composes its transform onto a child", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(5, 0));
    const group: GroupLayer = {
      kind: "group",
      id: "g",
      transform: { pos: new Vector3(100, 0, 0), rotation: 0, scale: new Vector3(2, 2, 1) },
      visible: true,
      locked: false,
      children: [child],
    };
    const [rs] = flattenLayers([group]);
    const worldChildOrigin = fromLocal(group.transform, fromLocal(child.transform, v(0, 0)));
    expect(worldChildOrigin.x).toBeCloseTo(110, 5);
    const back = affineApply(rs!.invAffine, worldChildOrigin);
    expect(back.x).toBeCloseTo(0, 4);
    expect(back.y).toBeCloseTo(0, 4);
  });

  it("z composes: group elevation adds, group tallness multiplies", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(0, 0));
    child.transform.pos = child.transform.pos.withZ(3);
    child.transform.scale = child.transform.scale.withZ(2);
    const group: GroupLayer = {
      kind: "group",
      id: "g",
      transform: { pos: new Vector3(0, 0, 10), rotation: 0, scale: new Vector3(1, 1, 4) },
      visible: true,
      locked: false,
      children: [child],
    };
    const [rs] = flattenLayers([group]);
    expect(rs!.elevationZ).toBeCloseTo(13);
    expect(rs!.tallnessZ).toBeCloseTo(8);
  });

  it("hidden groups and hidden objects are dropped; z-order is DFS", () => {
    const a = createObjectInstance(ObjectTypeId.Sphere, v(0, 0));
    a.id = "a";
    const b = createObjectInstance(ObjectTypeId.Sphere, v(0, 0));
    b.id = "b";
    b.visible = false;
    const hidden: GroupLayer = {
      kind: "group",
      id: "hg",
      transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
      visible: false,
      locked: false,
      children: [createObjectInstance(ObjectTypeId.Sphere, v(0, 0))],
    };
    const out = flattenLayers([a, b, hidden]);
    expect(out.map((r) => r.object.id)).toEqual(["a"]);
  });

  it("resolveObjects wraps a flat list", () => {
    const out = resolveObjects([createObjectInstance(ObjectTypeId.Sphere, v(0, 0))]);
    expect(out).toHaveLength(1);
  });
});

describe("flattenLayers — group masks (scope tagging)", () => {
  it("a group's mask attaches to its child baked to world (scope 1, follow false)", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(0, 0));
    const g = group([child], { id: "g", transform: { pos: new Vector3(50, 20, 0), rotation: 0, scale: new Vector3(2, 2, 1) } });
    g.masks = [keepSquare(10, 0, 5)];
    const [rs] = flattenLayers([g]);
    expect(rs!.masks).toHaveLength(1);
    const m = rs!.masks[0]!;
    expect(m.scope).toBe(1);
    expect(m.follow).toBe(false); // baked to world
    // its first anchor sits at the group affine applied to the authored local anchor
    const want = affineApply(affineFromTRS(g.transform), v(5, -5)); // (10-5, 0-5)
    expect(m.anchors[0]!.p.x).toBeCloseTo(want.x, 5);
    expect(m.anchors[0]!.p.y).toBeCloseTo(want.y, 5);
  });

  it("a hidden mask (visible:false) is skipped, on an object and on a group", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(0, 0));
    child.masks = [{ ...keepSquare(0, 0, 3), visible: false }];
    const g = group([child]);
    g.masks = [{ ...keepSquare(0, 0, 8), visible: false }];
    const [rs] = flattenLayers([g]);
    expect(rs!.masks).toHaveLength(0); // both disabled -> no trimming
    // re-enabling the object's mask brings it back at scope 0
    child.masks = [keepSquare(0, 0, 3)];
    expect(flattenLayers([g])[0]!.masks.map((m) => m.scope)).toEqual([0]);
  });

  it("an object's own mask is scope 0; an ancestor group's is scope 1 (sorted)", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(0, 0));
    child.masks = [keepSquare(0, 0, 3)];
    const g = group([child]);
    g.masks = [keepSquare(0, 0, 8)];
    const [rs] = flattenLayers([g]);
    expect(rs!.masks.map((m) => m.scope)).toEqual([0, 1]);
    expect(rs!.masks[0]!.follow).toBe(true); // object's own, untouched
  });
});

describe("flattenLayers — mirror", () => {
  it("mirror=none and missing mirror resolve identically to a plain group", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(5, 3));
    const plain = flattenLayers([group([createObjectInstance(ObjectTypeId.Sphere, v(5, 3))])]);
    const none = flattenLayers([group([child], { mirror: "none" })]);
    expect(none).toHaveLength(1);
    expect(none[0]!.invAffine).toEqual(plain[0]!.invAffine);
  });

  it("mirror=x emits 2 copies; the reflected one reflects about the group origin", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(5, 0));
    const out = flattenLayers([group([child], { mirror: "x" })]);
    expect(out).toHaveLength(2);
    // base maps world (5,0) -> local (0,0); reflected maps world (-5,0) -> local (0,0)
    const base = affineApply(out[0]!.invAffine, v(5, 0));
    expect(base.x).toBeCloseTo(0, 5);
    expect(base.y).toBeCloseTo(0, 5);
    const refl = affineApply(out[1]!.invAffine, v(-5, 0));
    expect(refl.x).toBeCloseTo(0, 5);
    expect(refl.y).toBeCloseTo(0, 5);
  });

  it("mirror=quad emits 4 copies", () => {
    const out = flattenLayers([group([createObjectInstance(ObjectTypeId.Sphere, v(5, 5))], { mirror: "quad" })]);
    expect(out).toHaveLength(4);
  });

  it("mirrorEnabled:false disables the mirror: one copy, no auto-clip (a plain group)", () => {
    const out = flattenLayers([group([createObjectInstance(ObjectTypeId.Sphere, v(5, 0))], { mirror: "x", mirrorEnabled: false })]);
    expect(out).toHaveLength(1); // no reflection
    expect(out[0]!.masks).toHaveLength(0); // no source clip
  });

  it("mirror=x auto-clips each copy to the source (negative) side of its own frame", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(0, 0));
    const out = flattenLayers([group([child], { mirror: "x" })]);
    expect(out).toHaveLength(2);
    // each copy carries exactly one (auto-clip) keep mask, scope 1, baked to world
    for (const rs of out) {
      expect(rs.masks).toHaveLength(1);
      expect(rs.masks[0]!.mode).toBe("keep");
      expect(rs.masks[0]!.scope).toBe(1);
      expect(rs.masks[0]!.follow).toBe(false);
    }
    // the base keeps world x<=0, the reflected copy keeps world x>=0 (the far side shows the reflection)
    const clipKeepsLeft = (rs: (typeof out)[number]): boolean =>
      rs.masks[0]!.anchors.every((a) => a.p.x <= 1e-6);
    expect(clipKeepsLeft(out[0]!)).toBe(true); // base: source half (left)
    expect(out[1]!.masks[0]!.anchors.every((a) => a.p.x >= -1e-6)).toBe(true); // reflected: right half
  });

  it("a user mask on a mirror group adds a second scope and reflects with the copy", () => {
    const child = createObjectInstance(ObjectTypeId.Sphere, v(0, 0));
    const g = group([child], { mirror: "x" });
    g.masks = [keepSquare(-10, 0, 5)]; // a user keep mask on the source side
    const out = flattenLayers([g]);
    // scope 1 = auto clip, scope 2 = the user mask (reflected per copy)
    expect(out[0]!.masks.map((m) => m.scope)).toEqual([1, 2]);
    const baseUser = out[0]!.masks[1]!;
    const reflUser = out[1]!.masks[1]!;
    expect(baseUser.anchors[0]!.p.x).toBeCloseTo(-15, 5); // -10-5 on the source side
    expect(reflUser.anchors[0]!.p.x).toBeCloseTo(15, 5); // reflected across x
  });
});
