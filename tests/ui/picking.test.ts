import { expect, test } from "vitest";
import "../../src/field/objects";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import { resolveObjects } from "../../src/field/flatten";
import { createMask } from "../../src/field/maskOps";
import { axisScaleFromDrag, constrainAxis, grabGroup, pointsInBox, pickObject, rotationFromDrag, snapAngle, toggleIndex } from "../../src/ui/picking";
import { toLocal } from "../../src/field/transform";
import { v2 } from "../../src/field/vec";
import { Vector3 } from "../../src/math";

test("toggleIndex: adds when absent, removes when present", () => {
  expect(toggleIndex([1, 2], 3)).toEqual([1, 2, 3]);
  expect(toggleIndex([1, 2, 3], 2)).toEqual([1, 3]);
  expect(toggleIndex([], 5)).toEqual([5]);
});

test("grabGroup: keeps the selection when i is in it, else collapses to [i]", () => {
  const sel = [1, 2, 3];
  expect(grabGroup(sel, 2)).toBe(sel); // i selected -> whole group (same ref; the drag moves all)
  expect(grabGroup(sel, 9)).toEqual([9]); // i not selected -> just this one
  expect(grabGroup([], 4)).toEqual([4]);
});

test("pickObject: topmost (last in z-order) wins, slop catches near-misses", () => {
  const below = createObjectInstance(ObjectTypeId.Sphere, v2(50, 50));
  const above = createObjectInstance(ObjectTypeId.Plateau, v2(60, 50));
  expect(pickObject(resolveObjects([below, above]),v2(62, 50))?.id).toBe(above.id); // inside both -> above
  expect(pickObject(resolveObjects([below, above]),v2(20, 50))?.id).toBe(below.id); // only dome
  expect(pickObject(resolveObjects([below, above]),v2(50, 99.5))).toBe(null); // dome rim at 98; 1px slop misses
  expect(pickObject(resolveObjects([below, above]),v2(50, 98.5))?.id).toBe(below.id); // within slop
});

test("pickObject skips invisible and locked objects (but includeLocked reaches locked ones)", () => {
  const a = createObjectInstance(ObjectTypeId.Sphere, v2(0, 0));
  a.visible = false;
  const b = createObjectInstance(ObjectTypeId.Sphere, v2(0, 0));
  b.locked = true;
  expect(pickObject(resolveObjects([a]), v2(0, 0))).toBe(null);
  expect(pickObject(resolveObjects([b]), v2(0, 0))).toBe(null); // drag-pick skips locked
  expect(pickObject(resolveObjects([b]), v2(0, 0), true)?.id).toBe(b.id); // right-click reaches it (to Unlock)
  expect(pickObject(resolveObjects([a]), v2(0, 0), true)).toBe(null); // invisible stays unpickable (flatten dropped it)
});

test("pickObject respects masks: a cut-away region isn't selectable through the shape's own hole", () => {
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(32, 32));
  slab.transform.scale = new Vector3(1.2, 1.2, 1); // covers most of a 64x64 canvas
  slab.masks = [createMask([v2(24, 24), v2(40, 24), v2(40, 40), v2(24, 40)], false)]; // keep only 24..40
  const resolved = resolveObjects([slab]);
  expect(pickObject(resolved, v2(32, 32))?.id).toBe(slab.id); // inside the keep loop -> selectable
  expect(pickObject(resolved, v2(6, 6))).toBe(null); // inside the footprint but masked away -> not pickable
});

test("rotationFromDrag: quarter turn around the pivot", () => {
  const rot = rotationFromDrag(v2(0, 0), v2(10, 0), v2(0, 10), 0.5);
  expect(rot).toBeCloseTo(0.5 + Math.PI / 2);
});

test("axisScaleFromDrag: per-axis unlocked scaling (corner drag, z untouched)", () => {
  const s = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(20, 5), new Vector3(1, 1, 0.7), false);
  expect(s.x).toBeCloseTo(2);
  expect(s.y).toBeCloseTo(0.5);
  expect(s.z).toBe(0.7);
});

test("axisScaleFromDrag: uniform lock scales all three axes (tallness follows)", () => {
  const s = axisScaleFromDrag(v2(0, 0), 0, v2(10, 0), v2(20, 0), new Vector3(1, 2, 1), true);
  expect(s.x).toBeCloseTo(2);
  expect(s.y).toBeCloseTo(4);
  expect(s.z).toBeCloseTo(2);
});

test("axisScaleFromDrag: axes follow the object's rotation", () => {
  // object rotated +90deg: its local +x axis points down-screen (+y canvas)
  const s = axisScaleFromDrag(v2(0, 0), Math.PI / 2, v2(0, 10), v2(0, 20), new Vector3(1, 1, 1), false);
  expect(s.x).toBeCloseTo(2); // dragged along local x
  expect(s.y).toBeCloseTo(1);
});

test("axisScaleFromDrag: near-zero start axis is left unchanged, never goes negative", () => {
  const onAxis = axisScaleFromDrag(v2(0, 0), 0, v2(10, 0), v2(20, 7), new Vector3(1, 1, 1), false);
  expect(onAxis.x).toBeCloseTo(2);
  expect(onAxis.y).toBe(1); // start y component ~0: leave alone, no explosion
  const acrossPivot = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(-20, 10), new Vector3(1, 1, 1), false);
  expect(acrossPivot.x).toBeCloseTo(2); // dragging across the pivot clamps magnitude, no mirror
  const tiny = axisScaleFromDrag(v2(0, 0), 0, v2(10, 10), v2(0.01, 10), new Vector3(1, 1, 1), false);
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
  const t = { pos: new Vector3(7, -3, 0), rotation: 0.6, scale: new Vector3(1.5, 0.75, 1) };
  const cp = v2(12, -8);
  const forward = v2(
    t.pos.x + (cp.x * t.scale.x * Math.cos(t.rotation) - cp.y * t.scale.y * Math.sin(t.rotation)),
    t.pos.y + (cp.x * t.scale.x * Math.sin(t.rotation) + cp.y * t.scale.y * Math.cos(t.rotation)),
  );
  const back = toLocal(t, forward);
  expect(back.x).toBeCloseTo(cp.x);
  expect(back.y).toBeCloseTo(cp.y);
});

test("pointsInBox: indices of canvas points inside the marquee, order-independent corners", () => {
  const pts = [v2(0, 0), v2(5, 5), v2(20, 20), v2(-3, 8)];
  expect(pointsInBox(pts, v2(-1, -1), v2(10, 10))).toEqual([0, 1]);
  expect(pointsInBox(pts, v2(10, 10), v2(-1, -1))).toEqual([0, 1]); // a/b swapped = same box
  expect(pointsInBox(pts, v2(-5, 6), v2(0, 12))).toEqual([3]);
});
