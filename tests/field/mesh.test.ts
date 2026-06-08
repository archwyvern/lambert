import { expect, test } from "vitest";
import "../../src/field/shapes";
import { createShapeInstance, getShapeType } from "../../src/field/registry";
import { canConvertToMesh, convertToMesh } from "../../src/field/meshConvert";
import { evaluateField } from "../../src/field/evalCpu";
import { v2 } from "../../src/field/vec";

test("convertToMesh: plateau -> mesh keeps transform, builds rings into faces", () => {
  const plateau = createShapeInstance("plateau", v2(64, 64));
  expect(canConvertToMesh(plateau)).toBe(true);
  const mesh = convertToMesh(plateau);
  expect(mesh.typeId).toBe("mesh");
  expect(mesh.id).not.toBe(plateau.id);
  expect(mesh.controlPoints.length).toBe(8); // 4 base + 4 top
  expect(mesh.mesh!.z).toEqual([0, 0, 0, 0, 24, 24, 24, 24]); // base at 0, top at nominalHeight
  expect(mesh.mesh!.tris.length).toBe(10); // 2 top + 4 sides * 2
  expect(canConvertToMesh(mesh)).toBe(false); // a mesh isn't itself convertible
});

test("mesh eval: flat top at full height, sloped sides, zero outside", () => {
  const mesh = convertToMesh(createShapeInstance("plateau", v2(64, 64)));
  const type = getShapeType("mesh");
  // default plateau: base +/-32, top +/-20, height 24
  expect(type.eval(v2(0, 0), mesh).height).toBeCloseTo(24); // centre of the flat top
  expect(type.eval(v2(26, 0), mesh).height).toBeCloseTo(12); // mid-slope: base 32, top 20 -> half
  const out = type.eval(v2(40, 0), mesh);
  expect(out.height).toBe(0);
  expect(out.sd).toBeCloseTo(8); // 8px outside the base edge
});

test("mesh reproduces the plateau's height field after conversion", () => {
  const plateau = createShapeInstance("plateau", v2(64, 64));
  const mesh = convertToMesh(plateau);
  const a = evaluateField([plateau], 128, 128);
  const b = evaluateField([mesh], 128, 128);
  const px = (x: number, y: number): number => y * 128 + x;
  const probes: Array<[number, number]> = [
    [64, 64],
    [80, 64],
    [64, 80],
    [50, 50],
  ];
  for (const [x, y] of probes) {
    expect(b.heightMap[px(x, y)]!).toBeCloseTo(a.heightMap[px(x, y)]!, 1);
  }
});
