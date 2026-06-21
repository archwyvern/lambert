import { expect, test } from "vitest";
import { normalizeLayers } from "../../src/document/schema";
import type { ShapeInstance } from "../../src/field/types";

// normalizeLayers runs the legacy migrations (incl. ridge -> capsule) + hydrate on raw nodes.
const migrate = (raw: unknown): ShapeInstance => normalizeLayers([raw] as Parameters<typeof normalizeLayers>[0])[0] as ShapeInstance;

test("normalizeLayers: ridge -> capsule (spine length, width/2 radius, rotation aligned, no points)", () => {
  const c = migrate({
    id: "r",
    typeId: "ridge",
    params: { width: 24, profile: "round" },
    controlPoints: [
      { x: -32, y: 0 },
      { x: 32, y: 0 },
    ],
    transform: { pos: { x: 5, y: 6, z: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
    visible: true,
    locked: false,
  });
  expect(c.typeId).toBe("capsule");
  expect(c.params.length).toBeCloseTo(64);
  expect(c.params.radius).toBeCloseTo(12);
  expect(c.controlPoints.length).toBe(0);
});

test("normalizeLayers: a vertical ridge spine rotates the capsule to match", () => {
  const c = migrate({
    id: "r",
    typeId: "ridge",
    params: { width: 20 },
    controlPoints: [
      { x: 0, y: -20 },
      { x: 0, y: 20 },
    ],
    transform: { pos: { x: 0, y: 0, z: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
    visible: true,
    locked: false,
  });
  expect(c.params.length).toBeCloseTo(40);
  expect(c.transform.rotation).toBeCloseTo(Math.PI / 2); // spine pointed +y
});

test("normalizeLayers leaves other shapes untouched", () => {
  const dome = migrate({
    id: "d",
    typeId: "dome",
    params: {},
    controlPoints: [],
    transform: { pos: { x: 0, y: 0, z: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
    visible: true,
    locked: false,
  });
  expect(dome.typeId).toBe("dome");
});
