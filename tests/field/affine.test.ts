import { describe, expect, it } from "vitest";
import { Vector2, Vector3 } from "@aphralatrax/primitives";
import { affineApply, affineCompose, affineFromTRS, affineInvert, affineScaleHint } from "../../src/field/affine";
import { distanceScale, fromLocal, toLocal } from "../../src/field/transform";
import type { Transform2D } from "../../src/field/transform";

const v = (x: number, y: number): Vector2 => new Vector2(x, y);
const trs = (px: number, py: number, rot: number, sx: number, sy: number): Transform2D => ({
  pos: new Vector3(px, py, 0),
  rotation: rot,
  scale: new Vector3(sx, sy, 1),
});

describe("affine", () => {
  it("affineFromTRS forward matches transform.fromLocal", () => {
    const t = trs(10, 20, 0.7, 2, 3);
    const m = affineFromTRS(t);
    for (const p of [v(0, 0), v(5, -2), v(-3, 4)]) {
      const got = affineApply(m, p);
      const exp = fromLocal(t, p);
      expect(got.x).toBeCloseTo(exp.x, 6);
      expect(got.y).toBeCloseTo(exp.y, 6);
    }
  });

  it("the inverse maps world->local like transform.toLocal", () => {
    const t = trs(10, 20, 0.7, 2, 3);
    const inv = affineInvert(affineFromTRS(t));
    for (const p of [v(0, 0), v(12, 19), v(-3, 4)]) {
      const got = affineApply(inv, p);
      const exp = toLocal(t, p);
      expect(got.x).toBeCloseTo(exp.x, 6);
      expect(got.y).toBeCloseTo(exp.y, 6);
    }
  });

  it("affineScaleHint matches distanceScale for a TRS", () => {
    const t = trs(0, 0, 1.1, 2, 5);
    expect(affineScaleHint(affineFromTRS(t))).toBeCloseTo(distanceScale(t), 6);
  });

  it("compose(p,q) equals applying q then p, and survives a sheared (non-uniform parent + rotated child)", () => {
    const parent = affineFromTRS(trs(7, -4, 0.3, 2, 0.5)); // non-uniform
    const child = affineFromTRS(trs(1, 2, 0.9, 1.4, 1.4)); // rotated
    const composed = affineCompose(parent, child);
    for (const p of [v(0, 0), v(3, 1), v(-2, 5)]) {
      const seq = affineApply(parent, affineApply(child, p));
      const com = affineApply(composed, p);
      expect(com.x).toBeCloseTo(seq.x, 6);
      expect(com.y).toBeCloseTo(seq.y, 6);
    }
    // invert round-trips even though the composition shears
    const inv = affineInvert(composed);
    const round = affineApply(inv, affineApply(composed, v(2.5, -1.5)));
    expect(round.x).toBeCloseTo(2.5, 5);
    expect(round.y).toBeCloseTo(-1.5, 5);
  });

  it("invert handles a reflection (negative determinant)", () => {
    const reflectX = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const inv = affineInvert(reflectX);
    const round = affineApply(inv, affineApply(reflectX, v(3, 4)));
    expect(round.x).toBeCloseTo(3, 6);
    expect(round.y).toBeCloseTo(4, 6);
  });
});
