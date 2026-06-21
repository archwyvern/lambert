import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

// frustum defaults: length 64 (half 32), radius 16 (-x end), radius2 8 (+x end), profile round
const frustum = getShapeType("frustum");
const inst = createShapeInstance("frustum", v2(0, 0));

test("frustum: radius tapers linearly from radius (-x) to radius2 (+x)", () => {
  // peak height at the centreline (y=0) == the local radius at that x
  expect(frustum.eval(v2(-32, 0), inst).height).toBeCloseTo(16); // wide end
  expect(frustum.eval(v2(32, 0), inst).height).toBeCloseTo(8); // narrow end
  expect(frustum.eval(v2(0, 0), inst).height).toBeCloseTo(12); // midpoint = mix(16, 8)
});

test("frustum: y extent follows the local radius (narrow end is thinner)", () => {
  // just inside the wide rim still has surface; the same |y| is already outside the narrow end
  expect(frustum.eval(v2(-32, 12), inst).height).toBeGreaterThan(0); // inside wide radius 16
  expect(frustum.eval(v2(32, 12), inst).height).toBeCloseTo(0); // past narrow radius 8
});

test("frustum: flat caps — full local height up to the end, nothing past it", () => {
  expect(frustum.eval(v2(31, 0), inst).height).toBeGreaterThan(0); // just inside the +x cap
  expect(frustum.eval(v2(40, 0), inst).height).toBeCloseTo(0); // past the flat cap
});

test("frustum: length/radius/radius2 are float params, no editable vertices", () => {
  expect(frustum.controlPoints.kind).toBe("none");
  expect(inst.controlPoints.length).toBe(0);
  expect(frustum.params.radius2?.type).toBe("px");
});
