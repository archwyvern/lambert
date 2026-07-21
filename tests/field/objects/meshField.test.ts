import { describe, expect, test } from "vitest";
import { v2 } from "../../../src/field/vec";
import type { ObjectInstance } from "../../../src/field/types";
import { HARD_COVER_PX, meshFieldEval } from "../../../src/field/objects/meshField";

// A diamond mesh traced over a sprite's diagonal silhouette — the shape of the
// staircase-void bug: sprite boundary pixels drawn along the traced line have
// centers up to ~0.71px OUTSIDE the polygon, so a strict center-inside test
// leaves them mask-less (uncovered jagged fringe between fill and gizmo).
function diamond(z: number[] = [5, 5, 5, 5]): ObjectInstance {
  return {
    controlPoints: [v2(2, 32), v2(32, 2), v2(61, 32), v2(32, 61)],
    mesh: { z, tris: [[0, 1, 2], [0, 2, 3]], edges: [] },
    params: { smoothness: 0 },
  } as unknown as ObjectInstance;
}

describe("meshFieldEval hard-cover margin", () => {
  test("pixel center inside a triangle stays covered with its interpolated height", () => {
    const s = meshFieldEval(v2(32, 30), diamond());
    expect(s.sd).toBeLessThan(0);
    expect(s.height).toBeCloseTo(5, 9);
  });

  test("staircase pixel center just outside a diagonal edge is covered (the void)", () => {
    // (16.5, 16.5) sits 1/sqrt(2) ~ 0.707px outside the (2,32)-(32,2) edge (x+y=34,
    // interior side is x+y>34) — a sprite outline pixel the artist drew along the
    // traced line. Must be hard-covered.
    const s = meshFieldEval(v2(16.5, 16.5), diamond());
    expect(s.sd).toBeLessThan(0);
    expect(s.height).toBeCloseTo(5, 9);
  });

  test("covered staircase pixel takes the CLAMPED edge height, not an extrapolation", () => {
    // edge (2,32)->(32,2) runs z 10 -> 0; just outside its midpoint (17,17) the
    // clamped height is the midpoint lerp (5), continuing the panel's slope.
    const s = meshFieldEval(v2(16.6, 16.6), diamond([10, 0, 5, 5]));
    expect(s.sd).toBeLessThan(0);
    expect(s.height).toBeCloseTo(5, 6);
  });

  test("pixel clearly outside the margin stays uncovered with its edge distance", () => {
    const s = meshFieldEval(v2(5, 5), diamond());
    expect(s.sd).toBeGreaterThan(HARD_COVER_PX);
    expect(s.height).toBe(0);
  });

  test("overlapping (folded-over) triangles: the highest surface wins, independent of order", () => {
    // two triangles over the same footprint at different heights — the fold-over shape
    const overlap = (tris: [number, number, number][]): ObjectInstance =>
      ({
        controlPoints: [v2(0, 0), v2(40, 0), v2(0, 40), v2(40, 40)],
        mesh: { z: [2, 2, 2, 20], tris, edges: [] },
        params: { smoothness: 0 },
      }) as unknown as ObjectInstance;
    // tris (0,1,2) and (0,1,3) overlap in the wedge y < x, x + y < 40. At p=(15,5):
    // (0,1,2) is flat 2; (0,1,3) interpolates toward z3=20 -> 2(w+u) + 20v = 4.25. Max wins
    // regardless of array order (first-hit used to make this order-dependent).
    const a = meshFieldEval(v2(15, 5), overlap([[0, 1, 2], [0, 1, 3]]));
    const b = meshFieldEval(v2(15, 5), overlap([[0, 1, 3], [0, 1, 2]]));
    expect(a.height).toBeCloseTo(4.25, 9);
    expect(b.height).toBeCloseTo(4.25, 9);
    expect(a.sd).toBeLessThan(0);
  });

  test("margin is in DOC pixels: object scale shrinks the local margin", () => {
    // At scaleHint 4 the 0.707-local-px staircase point is ~2.8 DOC px out — uncovered.
    const s = meshFieldEval(v2(16.5, 16.5), diamond(), 4);
    expect(s.sd).toBeGreaterThan(0);
    // At scaleHint 0.25 it is ~0.18 DOC px out — covered.
    const s2 = meshFieldEval(v2(16.5, 16.5), diamond(), 0.25);
    expect(s2.sd).toBeLessThan(0);
  });
});
