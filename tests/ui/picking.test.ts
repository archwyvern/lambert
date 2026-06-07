import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import { axisScaleFromDrag, constrainAxis, groupScaleFactor, pointsBounds, scalePointsAbout, pickShape, rotationFromDrag, snapAngle } from "../../src/ui/picking";
import { toLocal } from "../../src/field/transform";
import { v2 } from "../../src/field/vec";

test("pickShape: topmost (last in z-order) wins, slop catches near-misses", () => {
  const below = createShapeInstance("dome", v2(50, 50));
  const above = createShapeInstance("plateau", v2(60, 50));
  expect(pickShape([below, above], v2(62, 50))?.id).toBe(above.id); // inside both -> above
  expect(pickShape([below, above], v2(20, 50))?.id).toBe(below.id); // only dome
  expect(pickShape([below, above], v2(50, 99.5))).toBe(null); // dome rim at 98; 1px slop misses
  expect(pickShape([below, above], v2(50, 98.5))?.id).toBe(below.id); // within slop
});

test("pickShape skips invisible and locked shapes", () => {
  const a = createShapeInstance("dome", v2(0, 0));
  a.visible = false;
  const b = createShapeInstance("dome", v2(0, 0));
  b.locked = true;
  expect(pickShape([a], v2(0, 0))).toBe(null);
  expect(pickShape([b], v2(0, 0))).toBe(null);
});

test("rotationFromDrag: quarter turn around the pivot", () => {
  const rot = rotationFromDrag(v2(0, 0), v2(10, 0), v2(0, 10), 0.5);
  expect(rot).toBeCloseTo(0.5 + Math.PI / 2);
});

test("axisScaleFromDrag: per-axis unlocked scaling (corner drag, z untouched)", () => {
  const s = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(20, 5), { x: 1, y: 1, z: 0.7 }, false);
  expect(s.x).toBeCloseTo(2);
  expect(s.y).toBeCloseTo(0.5);
  expect(s.z).toBe(0.7);
});

test("axisScaleFromDrag: uniform lock scales all three axes (tallness follows)", () => {
  const s = axisScaleFromDrag(v2(0, 0), 0, v2(10, 0), v2(20, 0), { x: 1, y: 2, z: 1 }, true);
  expect(s.x).toBeCloseTo(2);
  expect(s.y).toBeCloseTo(4);
  expect(s.z).toBeCloseTo(2);
});

test("axisScaleFromDrag: axes follow the shape's rotation", () => {
  // shape rotated +90deg: its local +x axis points down-screen (+y canvas)
  const s = axisScaleFromDrag(v2(0, 0), Math.PI / 2, v2(0, 10), v2(0, 20), { x: 1, y: 1, z: 1 }, false);
  expect(s.x).toBeCloseTo(2); // dragged along local x
  expect(s.y).toBeCloseTo(1);
});

test("axisScaleFromDrag: near-zero start axis is left unchanged, never goes negative", () => {
  const onAxis = axisScaleFromDrag(v2(0, 0), 0, v2(10, 0), v2(20, 7), { x: 1, y: 1, z: 1 }, false);
  expect(onAxis.x).toBeCloseTo(2);
  expect(onAxis.y).toBe(1); // start y component ~0: leave alone, no explosion
  const acrossPivot = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(-20, 10), { x: 1, y: 1, z: 1 }, false);
  expect(acrossPivot.x).toBeCloseTo(2); // dragging across the pivot clamps magnitude, no mirror
  const tiny = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(0.01, 10), { x: 1, y: 1, z: 1 }, false);
  expect(tiny.x).toBeGreaterThanOrEqual(0.05);
});

test("snapAngle snaps to step increments", () => {
  const step = Math.PI / 12; // 15 deg
  expect(snapAngle(0.27, step)).toBeCloseTo(step);
  expect(snapAngle(-0.4, step)).toBeCloseTo(-2 * step);
});

test("constrainAxis locks to the dominant axis (godot move-mode shift)", () => {
  expect(constrainAxis(10, 3)).toEqual({ dx: 10, dy: 0 });
  expect(constrainAxis(2, -7)).toEqual({ dx: 0, dy: -7 });
});

test("gizmo forward transform must invert toLocal (scale THEN rotate)", () => {
  // guards the vertex-handle math in Gizmos.tsx
  const t = { pos: { x: 7, y: -3, z: 0 }, rotation: 0.6, scale: { x: 1.5, y: 0.75, z: 1 } };
  const cp = v2(12, -8);
  const forward = v2(
    t.pos.x + (cp.x * t.scale.x * Math.cos(t.rotation) - cp.y * t.scale.y * Math.sin(t.rotation)),
    t.pos.y + (cp.x * t.scale.x * Math.sin(t.rotation) + cp.y * t.scale.y * Math.cos(t.rotation)),
  );
  const back = toLocal(t, forward);
  expect(back.x).toBeCloseTo(cp.x);
  expect(back.y).toBeCloseTo(cp.y);
});

test("pointsBounds: min/max/centroid over a set", () => {
  const b = pointsBounds([v2(0, 0), v2(10, 4), v2(2, -6)]);
  expect(b.min).toEqual(v2(0, -6));
  expect(b.max).toEqual(v2(10, 4));
  expect(b.centroid.x).toBeCloseTo(4);
  expect(b.centroid.y).toBeCloseTo(-2 / 3);
});

test("groupScaleFactor: ratio of handle distance from pivot, axis-degenerate -> 1", () => {
  const f = groupScaleFactor(v2(0, 0), v2(10, 5), v2(20, 15));
  expect(f.x).toBeCloseTo(2);
  expect(f.y).toBeCloseTo(3);
  const deg = groupScaleFactor(v2(0, 0), v2(0, 5), v2(8, 10)); // start.x == pivot.x
  expect(deg.x).toBe(1); // no x scale when the handle sits on the pivot axis
  expect(deg.y).toBeCloseTo(2);
});

test("scalePointsAbout: scales each point around the pivot per axis", () => {
  const out = scalePointsAbout([v2(2, 2), v2(-2, 6)], v2(0, 2), v2(2, 0.5));
  expect(out[0]).toEqual(v2(4, 2)); // (2,2): x*2 about 0, y about 2 unchanged
  expect(out[1]).toEqual(v2(-4, 4)); // (-2,6): x*2, (6-2)*0.5+2 = 4
});
