import { expect, test } from "vitest";
import "../../../src/field/objects";
import { bakeRings, bezierAnchor } from "../../../src/field/bezier";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import type { ObjectInstance } from "../../../src/field/types";
import { v2 } from "../../../src/field/vec";

const pillow = getObjectType(ObjectTypeId.Pillow);

/** A pillow over a hand-laid closed loop (corner anchors -> the polygon itself). */
function pillowFrom(pts: [number, number][], holes: [number, number][][] = []): ObjectInstance {
  const inst = createObjectInstance(ObjectTypeId.Pillow, v2(0, 0));
  const corner = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
  const anchors = [...pts.map(([x, y]) => corner(x, y)), ...holes.flatMap((h) => h.map(([x, y]) => corner(x, y)))];
  const subpathStarts = holes.length ? [0, ...holes.map((_, i) => pts.length + holes.slice(0, i).reduce((n, hh) => n + hh.length, 0))].slice(1) : undefined;
  inst.bezier = anchors;
  inst.subpathStarts = subpathStarts;
  inst.closed = true;
  const b = bakeRings(anchors, subpathStarts);
  inst.controlPoints = b.controlPoints;
  inst.ringSplit = b.ringSplit;
  inst.contourCounts = b.contourCounts;
  return inst;
}

test("default pillow: inflated at the centre, 0 outside, rim falls toward 0", () => {
  const inst = createObjectInstance(ObjectTypeId.Pillow, v2(0, 0)); // ~circle r=40
  const centre = pillow.eval(v2(0, 0), inst).height;
  expect(centre).toBeGreaterThan(15);
  expect(pillow.eval(v2(0, 0), inst).sd).toBeLessThan(0);
  expect(pillow.eval(v2(60, 0), inst).height).toBe(0); // outside
  const nearRim = pillow.eval(v2(37, 0), inst).height;
  expect(nearRim).toBeGreaterThan(0);
  expect(nearRim).toBeLessThan(centre / 2);
});

test("thickest = tallest: a fat lobe out-inflates a thin neck (dumbbell outline)", () => {
  // a 100x60 slab pinched to a 100x12 neck in the middle third
  const dumbbell = pillowFrom([
    [-50, -30], [-17, -30], [-17, -6], [17, -6], [17, -30], [50, -30],
    [50, 30], [17, 30], [17, 6], [-17, 6], [-17, 30], [-50, 30],
  ]);
  const lobe = pillow.eval(v2(-33, 0), dumbbell).height;
  const neck = pillow.eval(v2(0, 0), dumbbell).height;
  expect(lobe).toBeGreaterThan(neck * 1.3);
});

test("holes deflate their rim to 0", () => {
  const holed = pillowFrom(
    [[-40, -40], [40, -40], [40, 40], [-40, 40]],
    [[[-10, -10], [10, -10], [10, 10], [-10, 10]]],
  );
  expect(pillow.eval(v2(0, 0), holed).height).toBe(0); // inside the hole: cut out
  const nearHole = pillow.eval(v2(14, 0), holed).height;
  const midRing = pillow.eval(v2(25, 0), holed).height;
  expect(nearHole).toBeGreaterThan(0);
  expect(midRing).toBeGreaterThan(nearHole); // deflates toward the hole rim
});

test("NO medial-axis crease: the slope changes smoothly across a rectangle's centreline", () => {
  // a 120x50 rectangle: the raw distance transform kinks at y=0 (|dh/dy| jumps sign at full slope).
  // The soft field must be C1 there: the discrete second difference stays SMALL relative to the
  // rim's, instead of the raw-distance spike (which concentrates the whole slope flip in one step).
  const rect = pillowFrom([[-60, -25], [60, -25], [60, 25], [-60, 25]]);
  const h = (y: number): number => pillow.eval(v2(0, y), rect).height;
  const dd = (y: number): number => Math.abs(h(y - 1) - 2 * h(y) + h(y + 1)); // |second difference|
  const atMedial = dd(0);
  // raw distance would give dd(0) = 2 full slope units (~2px); smooth field must be well under half that
  expect(atMedial).toBeLessThan(0.35);
  // and the field is symmetric about the medial axis
  expect(h(-7)).toBeCloseTo(h(7), 6);
});

test("Gradient effect: a directional ramp normalised across its region", () => {
  const g = createObjectInstance(ObjectTypeId.Gradient, v2(0, 0)); // 96px square, angle 90 (down), depth 12
  const t = getObjectType(ObjectTypeId.Gradient);
  expect(t.eval(v2(0, -48), g).height).toBeCloseTo(0, 3); // the low side
  expect(t.eval(v2(0, 48), g).height).toBeCloseTo(12, 3); // the high side
  expect(t.eval(v2(0, 0), g).height).toBeCloseTo(6, 3); // midway
  expect(t.eval(v2(30, 0), g).height).toBeCloseTo(6, 3); // constant across the perpendicular
  expect(t.eval(v2(0, 60), g).sd).toBeGreaterThan(0); // outside the region
});

test('extent "middle": no fixed-distance plateau — the surface keeps rising to the fattest point', () => {
  // a big slab: with inflate=10 the FIXED profile saturates ~10px in (flat top);
  // MIDDLE spans the whole half-width, so an intermediate point sits well below the peak
  const slab = (): ReturnType<typeof pillowFrom> => pillowFrom([[-100, -100], [100, -100], [100, 100], [-100, 100]]);
  const fixed = slab();
  fixed.params.inflate = 10;
  const middle = slab();
  middle.params.inflate = 10;
  middle.params.extent = "middle";
  middle.params.profile = "linear"; // h = 10·D/Dmax — makes the no-plateau shape easy to assert
  const mid = v2(0, 0);
  const between = v2(60, 0); // ~40px from the rim: fixed is long saturated here
  expect(pillow.eval(between, fixed).height).toBeCloseTo(10, 1); // plateau
  expect(pillow.eval(mid, fixed).height).toBeCloseTo(10, 1);
  const mBetween = pillow.eval(between, middle).height;
  const mMid = pillow.eval(mid, middle).height;
  expect(mBetween).toBeLessThan(8); // still rising — no plateau
  expect(mMid).toBeGreaterThan(mBetween); // joins at the middle
  expect(mMid).toBeCloseTo(10, 0); // amplitude reached at the fattest point
  // outside + rim behaviour unchanged
  expect(pillow.eval(v2(120, 0), middle).height).toBe(0);
});

test('extent "middle" packs as a negative inflate + the max distance in TRI_START', async () => {
  const { packObjects } = await import("../../../src/field/gpu/pack");
  const { resolveObjects } = await import("../../../src/field/flatten");
  const { PARAMS_OFFSET, RECORD_SLOT } = await import("../../../src/field/gpu/wgsl");
  const inst = pillowFrom([[-40, -40], [40, -40], [40, 40], [-40, 40]]);
  inst.params.extent = "middle";
  const packed = packObjects(resolveObjects([inst]));
  expect(packed.records[PARAMS_OFFSET]!).toBeLessThan(0); // sign = mode
  expect(packed.records[RECORD_SLOT.TRI_START]!).toBeGreaterThan(10); // the shape's own max soft distance
});
