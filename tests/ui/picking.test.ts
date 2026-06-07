import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance } from "../../src/field/registry";
import { pickShape, rotationFromDrag, scaleFromDrag } from "../../src/ui/picking";
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

test("scaleFromDrag: distance ratio, clamped away from zero", () => {
  const s = scaleFromDrag(v2(0, 0), v2(10, 0), v2(20, 0), { x: 1, y: 2 });
  expect(s.x).toBeCloseTo(2);
  expect(s.y).toBeCloseTo(4);
  const tiny = scaleFromDrag(v2(0, 0), v2(10, 0), v2(0.01, 0), { x: 1, y: 1 });
  expect(tiny.x).toBeGreaterThanOrEqual(0.05);
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
