import { describe, expect, it } from "vitest";
import { Vector2 } from "@carapace/primitives";
import { bezierAnchor, bakeMaskLoop, insertOnPath, nearestOnPath, resolveHandlesClosed } from "../../src/field/bezier";

const v = (x: number, y: number): Vector2 => new Vector2(x, y);
const corner = (x: number, y: number) => bezierAnchor(v(x, y), v(0, 0), v(0, 0), "manual");

describe("bakeMaskLoop", () => {
  it("all-corner loop bakes to exactly its anchor points", () => {
    const loop = bakeMaskLoop([corner(0, 0), corner(10, 0), corner(10, 10), corner(0, 10)]);
    expect(loop).toHaveLength(4);
    expect(loop.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it("a smooth anchor subdivides its adjoining segments", () => {
    // one smooth anchor among corners -> the two segments touching it are sampled (perSeg each)
    const loop = bakeMaskLoop([corner(0, 0), bezierAnchor(v(10, 0)), corner(10, 10), corner(0, 10)], 8);
    expect(loop.length).toBeGreaterThan(4);
  });

  it("closed resolve wraps tangents around (first anchor sees the last as its prev)", () => {
    const r = resolveHandlesClosed([bezierAnchor(v(0, 0)), bezierAnchor(v(10, 0)), bezierAnchor(v(5, 10))]);
    // smooth first anchor: hOut = (next - prev)/6, prev is the LAST anchor (wrap), not zero
    expect(r[0]!.hOut.x).toBeCloseTo((10 - 5) / 6, 6);
    expect(r[0]!.hOut.y).toBeCloseTo((0 - 10) / 6, 6);
  });
});

describe("nearestOnPath / insertOnPath (loop-aware curve insert)", () => {
  // a closed 100x100 square: anchors CW from top-left; the WRAP segment is left edge (3 -> 0)
  const square = [corner(-50, -50), corner(50, -50), corner(50, 50), corner(-50, 50)];

  it("hits the closed loop's wrap segment (the previously dead closing edge)", () => {
    const hit = nearestOnPath(square, undefined, true, v(-50, 0))!; // mid left edge
    expect(hit.seg).toBe(3); // the wrap segment
    expect(hit.loopStart).toBe(0);
    expect(hit.dist).toBeLessThan(1);
    expect(hit.point.x).toBeCloseTo(-50, 4);
  });

  it("insert on the wrap segment lands at the loop's END and keeps the outline", () => {
    const hit = nearestOnPath(square, undefined, true, v(-50, 10))!;
    const ins = insertOnPath(square, undefined, true, hit);
    expect(ins.index).toBe(4); // appended at the loop end, not spliced into the middle
    expect(ins.anchors).toHaveLength(5);
    expect(ins.anchors[4]!.p.x).toBeCloseTo(-50, 4); // exactly ON the edge
    expect(Math.abs(ins.anchors[4]!.p.y - 10)).toBeLessThan(3); // within the t-sampling step of the cursor
  });

  it("holed path: no phantom bridge segment, and inserts bump subpathStarts", () => {
    const hole = [corner(-10, -10), corner(10, -10), corner(10, 10), corner(-10, 10)];
    const anchors = [...square, ...hole];
    const starts = [0, 4];
    // a point between the outer's right edge (x=50) and the hole's right edge (x=10), nearer the hole:
    // the old open-chain search could hit the phantom segment bridging outer[3] -> hole[0]
    const holeHit = nearestOnPath(anchors, starts, true, v(12, 0))!;
    expect(holeHit.loopStart).toBe(4); // the hole loop, not a phantom bridge
    // insert into the OUTER loop: the hole's start must shift by one
    const outerHit = nearestOnPath(anchors, starts, true, v(0, -50))!; // mid top edge
    expect(outerHit.loopStart).toBe(0);
    const ins = insertOnPath(anchors, starts, true, outerHit);
    expect(ins.subpathStarts).toEqual([0, 5]);
    expect(ins.anchors).toHaveLength(9);
    // and inserting into the HOLE leaves starts untouched
    const ins2 = insertOnPath(anchors, starts, true, holeHit);
    expect(ins2.subpathStarts).toEqual([0, 4]);
    expect(ins2.index).toBeGreaterThanOrEqual(5);
  });

  it("open path: interior split preserves the curve point", () => {
    const line = [corner(0, 0), corner(100, 0)];
    const hit = nearestOnPath(line, undefined, false, v(40, 3))!;
    expect(hit.seg).toBe(0);
    const ins = insertOnPath(line, undefined, false, hit);
    expect(ins.index).toBe(1);
    expect(ins.anchors[1]!.p.y).toBeCloseTo(0, 4); // exactly ON the line
    expect(Math.abs(ins.anchors[1]!.p.x - 40)).toBeLessThan(3); // within the t-sampling step
  });
});
