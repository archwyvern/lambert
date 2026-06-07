import { expect, test } from "vitest";
import { applyProfile } from "../../src/field/profiles";

test("all profiles are 0 at the rim and 1 past slopeWidth", () => {
  for (const kind of ["linear", "smooth", "round", "cove"] as const) {
    expect(applyProfile(kind, 0, 12), kind).toBeCloseTo(0);
    expect(applyProfile(kind, 12, 12), kind).toBeCloseTo(1);
    expect(applyProfile(kind, 30, 12), kind).toBeCloseTo(1);
    expect(applyProfile(kind, -5, 12), kind).toBeCloseTo(0);
  }
});

test("profile midpoints", () => {
  expect(applyProfile("linear", 6, 12)).toBeCloseTo(0.5);
  expect(applyProfile("smooth", 6, 12)).toBeCloseTo(0.5);
  expect(applyProfile("round", 6, 12)).toBeCloseTo(Math.sqrt(0.75)); // convex bullnose
  expect(applyProfile("cove", 6, 12)).toBeCloseTo(1 - Math.sqrt(0.75)); // concave
});

test("zero slopeWidth is a hard step", () => {
  expect(applyProfile("linear", 0.001, 0)).toBe(1);
  expect(applyProfile("linear", -0.001, 0)).toBe(0);
});
