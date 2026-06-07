import { expect, test } from "vitest";
import "../../../src/field/shapes";
import { createShapeInstance } from "../../../src/field/registry";
import { packShapes } from "../../../src/field/gpu/pack";
import { RECORD_F32 } from "../../../src/field/gpu/wgsl";
import { v2 } from "../../../src/field/vec";

test("dome record: layout offsets", () => {
  const dome = createShapeInstance("dome", v2(10, 20));
  dome.transform.rotation = Math.PI / 2;
  dome.transform.scale = { x: 2, y: 4, z: 0.5 };
  dome.combine = { blend: 3 };
  const { records, points, count } = packShapes([dome]);
  expect(count).toBe(1);
  expect(records.length).toBe(RECORD_F32);
  expect(records[0]).toBe(0); // dome registered first -> typeIndex 0
  expect(records[1]).toBe(0); // op: dome clips (max)
  expect(records[2]).toBe(3); // blend
  expect(records[3]).toBe(0.5); // scale.z (tallness)
  expect(records[4]).toBe(10); // posX
  expect(records[5]).toBe(20); // posY
  expect(records[6]).toBeCloseTo(Math.cos(-Math.PI / 2));
  expect(records[7]).toBeCloseTo(Math.sin(-Math.PI / 2));
  expect(records[8]).toBeCloseTo(0.5); // invScaleX
  expect(records[9]).toBeCloseTo(0.25); // invScaleY
  expect(records[10]).toBeCloseTo(3); // distScale = (2+4)/2
  expect(records[11]).toBe(0); // cpStart
  expect(records[12]).toBe(0); // cpCount (dome has none)
  expect(records[13]).toBe(48); // radiusX
  expect(records[14]).toBe(48); // radiusY
  expect(records[21]).toBe(0); // elevation (pos.z)
  expect(points.length).toBe(2); // padded min one point
});

test("plateau: control points and enum param index", () => {
  const plateau = createShapeInstance("plateau", v2(0, 0));
  plateau.params.profile = "round";
  const { records, points } = packShapes([plateau]);
  expect(records[12]).toBe(8); // 4 base + 4 top-rim vertices
  expect(records[13]).toBe(2); // profile "round" -> options index 2
  expect(points[0]).toBe(-32); // first base vertex x
  expect(points[1]).toBe(-32); // first base vertex y
  expect(points[8]).toBe(-20); // first top-rim vertex x
  expect(points.length).toBe(16);
});

test("multiple shapes: cpStart advances, invisible skipped", () => {
  const a = createShapeInstance("plateau", v2(0, 0));
  const hidden = createShapeInstance("dome", v2(0, 0));
  hidden.visible = false;
  const b = createShapeInstance("ridge", v2(0, 0));
  const { records, count } = packShapes([a, hidden, b]);
  expect(count).toBe(2);
  expect(records.length).toBe(2 * RECORD_F32);
  expect(records[RECORD_F32 + 11]).toBe(8); // ridge cpStart after plateau's 8 points
  expect(records[RECORD_F32 + 12]).toBe(2); // ridge polyline 2 points
});

test("empty list still allocates non-empty buffers", () => {
  const { records, points, count } = packShapes([]);
  expect(count).toBe(0);
  expect(records.length).toBeGreaterThan(0);
  expect(points.length).toBeGreaterThan(0);
});
