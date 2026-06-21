import { describe, expect, it } from "vitest";
import { Vector2 } from "@carapace/primitives";
import { bezierAnchor, bakeMaskLoop, resolveHandlesClosed } from "../../src/field/bezier";

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
