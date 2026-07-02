import { expect, test } from "vitest";
import "../../../src/field/objects";
import { bezierAnchor } from "../../../src/field/bezier";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

// Cable: analytic Bézier sweep. Default radius 8, round profile, straight path (-40,0)..(40,0).
const pipe = getObjectType(ObjectTypeId.PipeVector);
const inst = createObjectInstance(ObjectTypeId.PipeVector, v2(0, 0));

test("pipe round: peak height == radius on the spine, zero + sd 0 at the rim", () => {
  expect(pipe.eval(v2(0, 0), inst).height).toBeCloseTo(8); // round tube peaks at the radius
  const rim = pipe.eval(v2(0, 8), inst); // 8px off the spine = the radius
  expect(rim.sd).toBeCloseTo(0);
  expect(rim.height).toBeCloseTo(0);
  expect(pipe.eval(v2(0, 20), inst).sd).toBeCloseTo(12); // 12px outside the rim
});

test("pipe exposes invert (raise/carve) + cap — invert drives the fold op, not the type", () => {
  expect(pipe.defaultCombine).toBeUndefined();
  expect(Object.keys(pipe.params)).toContain("invert");
  expect(Object.keys(pipe.params)).toContain("cap");
});

test("per-anchor SCALE tapers the tube (a Frustum as a vector): local radius = radius·scale", () => {
  const taperAnchor = (x: number, y: number, sc: number) => ({ ...bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual"), scale: sc });
  // params.radius 8 with end scales 2 / 0.5 -> local radii 16 / 4 (10 at the midpoint)
  const taper = { ...inst, bezier: [taperAnchor(-40, 0, 2), taperAnchor(40, 0, 0.5)] };
  // on the spine the round-tube height equals the LOCAL radius: 16 at the wide end, 4 at the narrow, 10 mid
  expect(pipe.eval(v2(-40, 0), taper).height).toBeCloseTo(16, 0);
  expect(pipe.eval(v2(40, 0), taper).height).toBeCloseTo(4, 0);
  expect(pipe.eval(v2(0, 0), taper).height).toBeCloseTo(10, 0);
  // the rim follows the local radius: |y| = 16 is the edge at the wide end
  expect(pipe.eval(v2(-40, 16), taper).sd).toBeCloseTo(0, 0);
});

test("closed path loops the last->first segment (O-ring)", () => {
  const corner = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
  // a triangle of straight corners; (-15,5) is the exact midpoint of the closing edge (0,30)->(-30,-20)
  const tri = { ...inst, bezier: [corner(-30, -20), corner(30, -20), corner(0, 30)] };
  const mid = v2(-15, 5);
  // closed: the wrap segment runs through mid -> inside the radius-8 tube
  expect(pipe.eval(mid, { ...tri, closed: true }).sd).toBeCloseTo(-8);
  // open: no closing segment there -> well outside
  expect(pipe.eval(mid, { ...tri, closed: false }).sd).toBeGreaterThan(0);
});
