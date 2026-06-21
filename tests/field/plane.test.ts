import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

test("plane seeds a flat quad polygon; flat (tilt 0) is zero height inside, sd outside", () => {
  const plane = createShapeInstance("plane", v2(64, 64));
  expect(plane.typeId).toBe("plane");
  expect(plane.controlPoints).toEqual([v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32)]);
  const type = getShapeType("plane");
  expect(type.eval(v2(0, 0), plane).height).toBe(0); // flat = no local height (elevation is pos.z)
  expect(type.eval(v2(20, -10), plane).height).toBe(0);
  const out = type.eval(v2(40, 0), plane);
  expect(out.sd).toBeCloseTo(8); // 8px outside the +/-32 edge
});

test("tilt ramps a non-negative slope from the ground: lowest edge at 0, rising along +tilt", () => {
  const plane = createShapeInstance("plane", v2(64, 64));
  plane.params.tiltX = 1; // slope uphill toward +x
  plane.params.tiltY = 0;
  const type = getShapeType("plane");
  // min-dot bias puts the -x edge (lowest) at 0; rises 1px per local px toward +x over the 64px span
  expect(type.eval(v2(-32, 0), plane).height).toBeCloseTo(0); // low edge on the ground
  expect(type.eval(v2(0, 0), plane).height).toBeCloseTo(32); // centre: 0 - (-32)
  expect(type.eval(v2(32, 0), plane).height).toBeCloseTo(64); // high edge: 64 across the span
});

test("tilt direction is independent of the magnitude axis (y tilt ramps in y)", () => {
  const plane = createShapeInstance("plane", v2(64, 64));
  plane.params.tiltX = 0;
  plane.params.tiltY = 0.5; // gentler slope toward +y
  const type = getShapeType("plane");
  expect(type.eval(v2(0, -32), plane).height).toBeCloseTo(0); // low edge (-y)
  expect(type.eval(v2(0, 32), plane).height).toBeCloseTo(32); // high edge: 0.5*64
  expect(type.eval(v2(20, 0), plane).height).toBeCloseTo(16); // x doesn't affect a pure-y tilt
});
