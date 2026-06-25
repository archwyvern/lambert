import { describe, expect, it } from "vitest";
import { ObjectTypeId } from "../../src/field/objectTypeIds";
import { Vector2, Vector3 } from "@carapace/primitives";
import { affineIdentity } from "../../src/field/affine";
import type { ResolvedMask } from "../../src/field/flatten";
import { bakeMasks, createMask, maskCoverage, setMaskFollow } from "../../src/field/maskOps";
import type { ObjectInstance } from "../../src/field/types";
import type { Transform2D } from "../../src/field/transform";

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

describe("setMaskFollow", () => {
  it("converting follow keeps the loop visually in place (round-trips through the transform)", () => {
    const t: Transform2D = { pos: new Vector3(100, 50, 0), rotation: 0.6, scale: new Vector3(2, 1.5, 1) };
    const object: ObjectInstance = {
      id: "s",
      typeId: ObjectTypeId.Sphere,
      transform: t,
      params: {},
      controlPoints: [],
      visible: true,
      locked: false,
      masks: [square(0, 0, 10, "keep", true)], // local
    };
    const toWorld = setMaskFollow(object, object.masks![0]!.id, false);
    const back = setMaskFollow(toWorld, toWorld.masks![0]!.id, true);
    const a = object.masks![0]!.anchors[0]!.p;
    const b = back.masks![0]!.anchors[0]!.p;
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.y).toBeCloseTo(a.y, 4);
    expect(toWorld.masks![0]!.follow).toBe(false);
  });
});
