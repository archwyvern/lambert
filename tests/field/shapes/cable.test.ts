import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { bezierAnchor, bezierSpine, nearestOnSpine, splitSegment } from "../../../src/field/bezier";
import { createShapeInstance, getShapeType } from "../../../src/field/registry";
import type { ShapeInstance } from "../../../src/field/types";
import { v2 } from "../../../src/field/vec";

test("bezierSpine: <2 anchors pass straight through; a corner pair samples the straight line", () => {
  expect(bezierSpine([bezierAnchor(v2(0, 0))], 8)).toEqual([v2(0, 0)]);
  const line = bezierSpine([bezierAnchor(v2(-10, 0)), bezierAnchor(v2(10, 0))], 8);
  expect(line.length).toBe(8 + 1); // perSeg + final endpoint
  expect(line[0]).toEqual(v2(-10, 0));
  expect(line[line.length - 1]).toEqual(v2(10, 0));
  expect(line[4]!.x).toBeCloseTo(0); // midpoint of the straight run
  expect(line[4]!.y).toBeCloseTo(0);
});

test("splitSegment: inserts an anchor on the curve, preserving shape (count + new point on the line)", () => {
  const a = [bezierAnchor(v2(-10, 0)), bezierAnchor(v2(10, 0))];
  const split = splitSegment(a, 0, 0.5);
  expect(split.length).toBe(3);
  expect(split[1]!.p.x).toBeCloseTo(0); // midpoint of the straight segment
  expect(split[1]!.p.y).toBeCloseTo(0);
});

test("nearestOnSpine: finds the closest segment + parameter", () => {
  const a = [bezierAnchor(v2(-10, 0)), bezierAnchor(v2(10, 0))];
  const near = nearestOnSpine(a, v2(0, 3));
  expect(near?.seg).toBe(0);
  expect(near?.t).toBeCloseTo(0.5, 1);
});

function cable(profile: "round" | "flat"): ShapeInstance {
  const s = createShapeInstance("cable", v2(0, 0)); // default corner anchors [-40,0],[40,0], thickness 16
  s.params.profile = profile;
  return s;
}

test("cable seeds a Bézier path and stays unbaked (no controlPoints)", () => {
  const s = cable("round");
  expect(s.bezier?.length).toBe(2); // two default corner anchors
  expect(s.bezier?.[0]!.hOut).toEqual(v2(0, 0)); // corners have zero handles
  expect(s.controlPoints.length).toBe(0); // unbaked — the path renders directly, nothing baked
});

test("cable round: full height on the spine, zero at the half-width rim", () => {
  const t = getShapeType("cable");
  const s = cable("round"); // thickness 16 -> halfWidth 8
  expect(t.eval(v2(0, 0), s).height).toBeCloseTo(16);
  expect(t.eval(v2(0, 0), s).sd).toBeCloseTo(-8);
  expect(t.eval(v2(0, 8), s).height).toBeCloseTo(0);
  expect(t.eval(v2(0, 12), s).sd).toBeGreaterThan(0);
});

test("cable flat vs round: round sits higher than flat's linear ramp partway in", () => {
  const t = getShapeType("cable");
  expect(t.eval(v2(0, 0), cable("flat")).height).toBeCloseTo(16);
  expect(t.eval(v2(0, 5), cable("round")).height).toBeGreaterThan(t.eval(v2(0, 5), cable("flat")).height);
});
