import { expect, test } from "vitest";
import "../../src/field/objects";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

test("polygon seeds a flat quad; flat (tilt 0) is zero height inside, sd outside", () => {
  const polygon = createObjectInstance(ObjectTypeId.Surface, v2(64, 64));
  expect(polygon.typeId).toBe(ObjectTypeId.Surface);
  expect(polygon.controlPoints).toEqual([v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32)]);
  const type = getObjectType(ObjectTypeId.Surface);
  expect(type.eval(v2(0, 0), polygon).height).toBe(0); // flat = no local height (elevation is pos.z)
  expect(type.eval(v2(20, -10), polygon).height).toBe(0);
  const out = type.eval(v2(40, 0), polygon);
  expect(out.sd).toBeCloseTo(8); // 8px outside the +/-32 edge
});

test("tilt ramps a non-negative slope from the ground: lowest edge at 0, rising along +tilt", () => {
  const polygon = createObjectInstance(ObjectTypeId.Surface, v2(64, 64));
  polygon.params.tiltX = 1; // slope uphill toward +x
  polygon.params.tiltY = 0;
  const type = getObjectType(ObjectTypeId.Surface);
  // min-dot bias puts the -x edge (lowest) at 0; rises 1px per local px toward +x over the 64px span
  expect(type.eval(v2(-32, 0), polygon).height).toBeCloseTo(0); // low edge on the ground
  expect(type.eval(v2(0, 0), polygon).height).toBeCloseTo(32); // centre: 0 - (-32)
  expect(type.eval(v2(32, 0), polygon).height).toBeCloseTo(64); // high edge: 64 across the span
});

test("tilt direction is independent of the magnitude axis (y tilt ramps in y)", () => {
  const polygon = createObjectInstance(ObjectTypeId.Surface, v2(64, 64));
  polygon.params.tiltX = 0;
  polygon.params.tiltY = 0.5; // gentler slope toward +y
  const type = getObjectType(ObjectTypeId.Surface);
  expect(type.eval(v2(0, -32), polygon).height).toBeCloseTo(0); // low edge (-y)
  expect(type.eval(v2(0, 32), polygon).height).toBeCloseTo(32); // high edge: 0.5*64
  expect(type.eval(v2(20, 0), polygon).height).toBeCloseTo(16); // x doesn't affect a pure-y tilt
});
