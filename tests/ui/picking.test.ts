import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import { axisScaleFromDrag, pickShape, rotationFromDrag } from "../../src/ui/picking";
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

test("axisScaleFromDrag: per-axis unlocked scaling (corner drag)", () => {
  const s = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(20, 5), { x: 1, y: 1 }, false);
  expect(s.x).toBeCloseTo(2);
  expect(s.y).toBeCloseTo(0.5);
});

test("axisScaleFromDrag: uniform lock uses the distance ratio on both axes", () => {
  const s = axisScaleFromDrag(v2(0, 0), 0, v2(10, 0), v2(20, 0), { x: 1, y: 2 }, true);
  expect(s.x).toBeCloseTo(2);
  expect(s.y).toBeCloseTo(4);
});

test("axisScaleFromDrag: axes follow the shape's rotation", () => {
  // shape rotated +90deg: its local +x axis points down-screen (+y canvas)
  const s = axisScaleFromDrag(v2(0, 0), Math.PI / 2, v2(0, 10), v2(0, 20), { x: 1, y: 1 }, false);
  expect(s.x).toBeCloseTo(2); // dragged along local x
  expect(s.y).toBeCloseTo(1);
});

test("axisScaleFromDrag: near-zero start axis is left unchanged, flips allowed", () => {
  const onAxis = axisScaleFromDrag(v2(0, 0), 0, v2(10, 0), v2(20, 7), { x: 1, y: 1 }, false);
  expect(onAxis.x).toBeCloseTo(2);
  expect(onAxis.y).toBe(1); // start y component ~0: leave alone, no explosion
  const flipped = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(-20, 10), { x: 1, y: 1 }, false);
  expect(flipped.x).toBeCloseTo(-2); // dragging across the pivot mirrors (photoshop-like)
  const tiny = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(0.01, 10), { x: 1, y: 1 }, false);
  expect(Math.abs(tiny.x)).toBeGreaterThanOrEqual(0.05);
});

test("gizmo forward transform must invert toLocal (scale THEN rotate)", () => {
  // guards the vertex-handle math in Gizmos.tsx
  const t = { pos: v2(7, -3), rotation: 0.6, scale: v2(1.5, 0.75) };
  const cp = v2(12, -8);
  const forward = v2(
    t.pos.x + (cp.x * t.scale.x * Math.cos(t.rotation) - cp.y * t.scale.y * Math.sin(t.rotation)),
    t.pos.y + (cp.x * t.scale.x * Math.sin(t.rotation) + cp.y * t.scale.y * Math.cos(t.rotation)),
  );
  const back = toLocal(t, forward);
  expect(back.x).toBeCloseTo(cp.x);
  expect(back.y).toBeCloseTo(cp.y);
});
