import { expect, test } from "vitest";
import { v2 } from "../../src/field/vec";
import { sdPolygon, sdSegment } from "../../src/field/sdf";

test("sdSegment: distance to a horizontal segment", () => {
  const a = v2(-10, 0);
  const b = v2(10, 0);
  expect(sdSegment(v2(0, 5), a, b)).toBeCloseTo(5);
  expect(sdSegment(v2(20, 0), a, b)).toBeCloseTo(10);
});

const square = [v2(-10, -10), v2(10, -10), v2(10, 10), v2(-10, 10)];

test("sdPolygon: signed distance to a square", () => {
  expect(sdPolygon(v2(0, 0), square)).toBeCloseTo(-10);
  expect(sdPolygon(v2(15, 0), square)).toBeCloseTo(5);
  expect(sdPolygon(v2(0, -15), square)).toBeCloseTo(5);
});

test("sdPolygon: winding-independent sign", () => {
  const reversed = [...square].reverse();
  expect(sdPolygon(v2(0, 0), reversed)).toBeCloseTo(-10);
  expect(sdPolygon(v2(15, 0), reversed)).toBeCloseTo(5);
});

test("sdPolygon: degenerate rings degrade to point/segment distance (no NaN)", () => {
  // 1 point = a cone apex: distance to the point, always positive (no interior)
  const apex = sdPolygon(v2(3, 4), [v2(0, 0)]);
  expect(apex).toBeCloseTo(5);
  expect(Number.isNaN(sdPolygon(v2(0, 0), [v2(0, 0)]))).toBe(false);
  // 2 points = a ridge top: distance to the segment
  expect(sdPolygon(v2(0, 5), [v2(-10, 0), v2(10, 0)])).toBeCloseTo(5);
  expect(Number.isNaN(sdPolygon(v2(0, 0), [v2(-10, 0), v2(10, 0)]))).toBe(false);
});
