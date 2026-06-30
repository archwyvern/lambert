import { describe, expect, it } from "vitest";
import { ObjectTypeId } from "../../src/field/objectTypeIds";
import { Vector2, Vector3 } from "@carapace/primitives";
import { affineApply, affineFromTRS, affineIdentity, affineInvert } from "../../src/field/affine";
import { flattenLayers, type ResolvedMask } from "../../src/field/flatten";
import { bakeMasks, createMask, maskCoverage, setMaskFollow, setMaskSpace } from "../../src/field/maskOps";
import type { GroupLayer, ObjectInstance } from "../../src/field/types";

const v = (x: number, y: number): Vector2 => new Vector2(x, y);
const ident = affineIdentity();
const square = (cx: number, cy: number, r: number, mode: "keep" | "cut", follow: boolean, scope = 0): ResolvedMask => ({
  ...createMask([v(cx - r, cy - r), v(cx + r, cy - r), v(cx + r, cy + r), v(cx - r, cy + r)], follow),
  mode,
  scope,
});

describe("maskCoverage", () => {
  it("no masks => full coverage", () => {
    expect(maskCoverage([], [], ident, 1, v(0, 0))).toBe(1);
  });

  it("a keep mask clips to inside it (1 inside, 0 well outside)", () => {
    const masks = [square(0, 0, 10, "keep", false)];
    const baked = bakeMasks(masks);
    expect(maskCoverage(masks, baked, ident, 1, v(0, 0))).toBeCloseTo(1, 5);
    expect(maskCoverage(masks, baked, ident, 1, v(50, 50))).toBe(0);
  });

  it("a cut mask removes inside it; keep+cut composes", () => {
    const masks = [square(0, 0, 20, "keep", false), square(0, 0, 5, "cut", false)];
    const baked = bakeMasks(masks);
    expect(maskCoverage(masks, baked, ident, 1, v(0, 0))).toBeCloseTo(0, 5); // inside the cut
    expect(maskCoverage(masks, baked, ident, 1, v(12, 0))).toBeCloseTo(1, 5); // inside keep, outside cut
  });

  it("scopes INTERSECT: a point must be kept by every scope (group mask vs object mask)", () => {
    // scope 0 keeps [-17,7], scope 1 (a group mask) keeps [-7,17]; they overlap on [-7,7].
    const masks = [square(-5, 0, 12, "keep", false, 0), square(5, 0, 12, "keep", false, 1)];
    const baked = bakeMasks(masks);
    // a point only scope 0 keeps is cut by scope 1, and vice-versa => 0 on both sides
    expect(maskCoverage(masks, baked, ident, 1, v(-11, 0))).toBeCloseTo(0, 5);
    expect(maskCoverage(masks, baked, ident, 1, v(11, 0))).toBeCloseTo(0, 5);
    // the overlap (x=0, well inside both squares) survives both scopes
    expect(maskCoverage(masks, baked, ident, 1, v(0, 0))).toBeCloseTo(1, 5);
  });

  it("within one scope keeps UNION (either keep shows); across scopes they would intersect", () => {
    const masks = [square(-10, 0, 8, "keep", false, 0), square(10, 0, 8, "keep", false, 0)];
    const baked = bakeMasks(masks);
    expect(maskCoverage(masks, baked, ident, 1, v(-10, 0))).toBeCloseTo(1, 5); // left keep
    expect(maskCoverage(masks, baked, ident, 1, v(10, 0))).toBeCloseTo(1, 5); // right keep (same scope => union)
  });
});

describe("setMaskSpace / setMaskFollow", () => {
  // A world frame that is NOT the mask owner's own transform — i.e. the owner sits under a transformed
  // ancestor (a grouped object / nested group). This is the case the old code got wrong: it converted
  // through the owner's local transform, ignoring the ancestor, so the loop jumped on toggle.
  const frame = affineFromTRS({ pos: new Vector3(100, 50, 0), rotation: 0.6, scale: new Vector3(2, 1.5, 1) });
  const inv = affineInvert(frame);

  it("setMaskSpace preserves the mask's WORLD position when unfollowing (and round-trips)", () => {
    const m = createMask([v(10, 20), v(30, 20), v(30, 40)], true); // follow = local space
    const worldBefore = m.anchors.map((a) => affineApply(frame, a.p));
    const pinned = setMaskSpace(m, false, frame, inv);
    expect(pinned.follow).toBe(false);
    pinned.anchors.forEach((a, i) => {
      expect(a.p.x).toBeCloseTo(worldBefore[i]!.x, 6);
      expect(a.p.y).toBeCloseTo(worldBefore[i]!.y, 6);
    });
    const back = setMaskSpace(pinned, true, frame, inv);
    back.anchors.forEach((a, i) => {
      expect(a.p.x).toBeCloseTo(m.anchors[i]!.p.x, 6);
      expect(a.p.y).toBeCloseTo(m.anchors[i]!.p.y, 6);
    });
  });

  it("handle tips survive the space conversion", () => {
    const m = createMask([v(0, 0)], true);
    m.anchors[0] = { ...m.anchors[0]!, hOut: v(4, 0) };
    const a = setMaskSpace(m, false, frame, inv).anchors[0]!;
    const tip = affineApply(frame, v(4, 0));
    expect(a.p.x + a.hOut.x).toBeCloseTo(tip.x, 6);
    expect(a.p.y + a.hOut.y).toBeCloseTo(tip.y, 6);
  });

  it("setMaskFollow converts the named mask on a node through the given world frame", () => {
    const object: ObjectInstance = {
      id: "s",
      typeId: ObjectTypeId.Sphere,
      transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
      params: {},
      controlPoints: [],
      visible: true,
      locked: false,
      masks: [square(0, 0, 10, "keep", true)],
    };
    const before = object.masks![0]!.anchors.map((a) => affineApply(frame, a.p));
    const pinned = setMaskFollow(object, object.masks![0]!.id, false, frame, inv);
    expect(pinned.masks![0]!.follow).toBe(false);
    pinned.masks![0]!.anchors.forEach((a, i) => {
      expect(a.p.x).toBeCloseTo(before[i]!.x, 6);
      expect(a.p.y).toBeCloseTo(before[i]!.y, 6);
    });
  });

  it("setMaskSpace is a no-op when follow is unchanged", () => {
    const m = createMask([v(1, 2)], true);
    expect(setMaskSpace(m, true, frame, inv)).toBe(m);
  });
});

describe("mirror + pinned group mask", () => {
  it("a pinned (follow=false) group mask still reflects on a mirror group (reflection not cut)", () => {
    // a keep mask on the SOURCE side (x in [-30,-10]); the group mirrors across x (the local Y axis).
    const mask = { ...createMask([v(-30, -10), v(-10, -10), v(-10, 10), v(-30, 10)], false), id: "gm" };
    const obj: ObjectInstance = {
      id: "o",
      typeId: ObjectTypeId.Sphere,
      transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
      params: {},
      controlPoints: [],
      visible: true,
      locked: false,
    };
    const group: GroupLayer = {
      kind: "group",
      id: "g",
      transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
      visible: true,
      locked: false,
      mirror: "x",
      mirrorEnabled: true,
      masks: [mask],
      children: [obj],
    };
    const resolved = flattenLayers([group]);
    expect(resolved.length).toBe(2); // mirror x => source + reflected copies of the object

    const extents = resolved.map((r) => {
      const xs = r.masks.find((m) => m.id === "gm")!.anchors.map((a) => a.p.x);
      return { min: Math.min(...xs), max: Math.max(...xs) };
    });
    // one copy keeps the source side (x<0); the OTHER must be reflected to the far side (x>0). Without
    // the fix the pinned mask is unchanged on both copies, so the reflected copy is cut (no x>0 mask).
    expect(extents.some((e) => e.max < 0)).toBe(true);
    expect(extents.some((e) => e.min > 0)).toBe(true);
  });

  it("a pinned OBJECT mask (object inside a mirror group) reflects per copy too", () => {
    // the mask lives on the OBJECT (scope 0), not the group — the case the first fix missed.
    const obj: ObjectInstance = {
      id: "o",
      typeId: ObjectTypeId.Sphere,
      transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
      params: {},
      controlPoints: [],
      visible: true,
      locked: false,
      masks: [{ ...createMask([v(-30, -10), v(-10, -10), v(-10, 10), v(-30, 10)], false), id: "om" }],
    };
    const group: GroupLayer = {
      kind: "group",
      id: "g",
      transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
      visible: true,
      locked: false,
      mirror: "x",
      mirrorEnabled: true,
      children: [obj],
    };
    const resolved = flattenLayers([group]);
    expect(resolved.length).toBe(2);
    const extents = resolved.map((r) => {
      const xs = r.masks.find((m) => m.id === "om")!.anchors.map((a) => a.p.x);
      return { min: Math.min(...xs), max: Math.max(...xs) };
    });
    expect(extents.some((e) => e.max < 0)).toBe(true); // source copy keeps x<0
    expect(extents.some((e) => e.min > 0)).toBe(true); // reflected copy must reflect to x>0
  });
});
