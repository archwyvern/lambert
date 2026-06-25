import { expect, test } from "vitest";
import {
  deleteVertices,
  frustumStrip,
  insertVertex,
  polygonStats,
  regularPolygon,
  regularPolygonAligned,
  resamplePolyline,
  ringPhase,
} from "../../src/field/controlPoints";
import { v2 } from "../../src/field/vec";

test("insertVertex: places the new point right after afterIndex", () => {
  const pts = [v2(0, 0), v2(10, 0), v2(10, 10)];
  const out = insertVertex(pts, 0, v2(5, 0));
  expect(out.map((p) => [p.x, p.y])).toEqual([
    [0, 0],
    [5, 0],
    [10, 0],
    [10, 10],
  ]);
  expect(pts.length).toBe(3); // original untouched
});

test("insertVertex: afterIndex = last appends (wrap edge)", () => {
  const out = insertVertex([v2(0, 0), v2(10, 0)], 1, v2(20, 0));
  expect(out[2]).toEqual(v2(20, 0));
});

test("deleteVertices: removes the indices when above the minimum", () => {
  const pts = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)];
  expect(deleteVertices(pts, [1], 3)?.map((p) => [p.x, p.y])).toEqual([
    [0, 0],
    [10, 10],
    [0, 10],
  ]);
});

test("deleteVertices: returns null when it would drop below the minimum", () => {
  expect(deleteVertices([v2(0, 0), v2(10, 0), v2(5, 10)], [0], 3)).toBeNull();
  expect(deleteVertices([v2(0, 0), v2(10, 0), v2(5, 10)], [0, 1], 2)).toBeNull();
});

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

test("regularPolygonAligned: vertex 0 points along the reference angle, all on the radius", () => {
  const ring = regularPolygonAligned(v2(0, 0), 10, 5, Math.PI / 2);
  expect(ring[0]!.x).toBeCloseTo(0);
  expect(ring[0]!.y).toBeCloseTo(10);
  for (const p of ring) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10);
});

test("ringPhase + regularPolygonAligned keep two rings index-aligned (no twist)", () => {
  const outer = regularPolygon(v2(0, 0), 30, 4);
  const inner = regularPolygonAligned(v2(0, 0), 15, 4, ringPhase(outer));
  for (let i = 0; i < 4; i++) {
    const ao = Math.atan2(outer[i]!.y, outer[i]!.x);
    const ai = Math.atan2(inner[i]!.y, inner[i]!.x);
    expect(Math.cos(ao - ai)).toBeCloseTo(1); // base[i] over top[i]
  }
});

test("frustumStrip: one triangle per step, every vertex referenced (equal counts, apex, mismatch)", () => {
  for (const [nB, nT] of [[4, 4], [4, 1], [4, 5], [5, 4], [8, 3]] as const) {
    const tris = frustumStrip(nB, nT);
    expect(tris.length).toBe(nB + nT);
    const outerSeen = new Set<number>();
    const innerSeen = new Set<number>();
    for (const tri of tris) for (const [r, idx] of tri) (r === 0 ? outerSeen : innerSeen).add(idx);
    expect(outerSeen.size).toBe(nB);
    expect(innerSeen.size).toBe(nT);
  }
});
