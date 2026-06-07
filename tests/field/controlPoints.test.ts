import { expect, test } from "vitest";
import { polygonStats, regularPolygon, resamplePolyline } from "../../src/field/controlPoints";
import { v2 } from "../../src/field/vec";

test("regularPolygon: n=4 is an axis-aligned square", () => {
  const square = regularPolygon(v2(0, 0), Math.SQRT2, 4);
  expect(square.length).toBe(4);
  expect(square[0]!.x).toBeCloseTo(1);
  expect(square[0]!.y).toBeCloseTo(-1);
  expect(square[2]!.x).toBeCloseTo(-1);
  expect(square[2]!.y).toBeCloseTo(1);
});

test("regularPolygon: vertices sit on the radius around the centroid", () => {
  const oct = regularPolygon(v2(10, -5), 32, 8);
  expect(oct.length).toBe(8);
  for (const p of oct) {
    expect(Math.hypot(p.x - 10, p.y + 5)).toBeCloseTo(32);
  }
});

test("polygonStats recovers centroid and mean radius", () => {
  const oct = regularPolygon(v2(7, 3), 20, 8);
  const stats = polygonStats(oct);
  expect(stats.centroid.x).toBeCloseTo(7);
  expect(stats.centroid.y).toBeCloseTo(3);
  expect(stats.radius).toBeCloseTo(20);
});

test("resamplePolyline spaces points evenly by arc length", () => {
  expect(resamplePolyline([v2(0, 0), v2(10, 0)], 3)).toEqual([v2(0, 0), v2(5, 0), v2(10, 0)]);
  const bent = resamplePolyline([v2(0, 0), v2(10, 0), v2(10, 10)], 3);
  expect(bent[0]).toEqual(v2(0, 0));
  expect(bent[1]!.x).toBeCloseTo(10);
  expect(bent[1]!.y).toBeCloseTo(0);
  expect(bent[2]).toEqual(v2(10, 10));
});
