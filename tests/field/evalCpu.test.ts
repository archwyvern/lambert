import { expect, test } from "vitest";
import "../../src/field/objects";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import { evaluateField } from "../../src/field/evalCpu";
import { resolveObjects } from "../../src/field/flatten";
import { v2 } from "../../src/field/vec";
import { Vector3 } from "../../src/math";

const px = (r: { width: number }, x: number, y: number) => y * r.width + x;

test("single dome: height at center, zero + unmasked far away", () => {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(64, 64));
  const r = evaluateField(resolveObjects([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeGreaterThan(23.9);
  expect(r.mask[px(r, 64, 64)]!).toBe(1);
  expect(r.heightMap[px(r, 4, 4)]!).toBe(0);
  expect(r.mask[px(r, 4, 4)]!).toBe(0);
});

test("invisible objects are skipped", () => {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(64, 64));
  dome.visible = false;
  const r = evaluateField(resolveObjects([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBe(0);
  expect(r.mask[px(r, 64, 64)]!).toBe(0);
});

test("max: overlapping objects merge to the taller", () => {
  const low = createObjectInstance(ObjectTypeId.Plateau, v2(64, 64));
  const tall = createObjectInstance(ObjectTypeId.Plateau, v2(80, 64));
  tall.transform.scale = tall.transform.scale.withZ(40 / 24); // extrude to 40px
  const r = evaluateField(resolveObjects([low, tall]), 160, 128);
  expect(r.heightMap[px(r, 80, 64)]!).toBeCloseTo(40, 0); // overlap: taller wins
});

test("objects clip: overlapping objects do not stack heights", () => {
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(64, 64));
  const stud = createObjectInstance(ObjectTypeId.Sphere, v2(64, 64));
  stud.transform.scale = new Vector3(8 / 48, 8 / 48, 10 / 48); // 8px stud, 10px tall
  const r = evaluateField(resolveObjects([slab, stud]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(24, 0); // max(24, ~10), not 34
});

test("carve cuts into what is below", () => {
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(64, 64));
  const cut = createObjectInstance(ObjectTypeId.PipeVector, v2(64, 64));
  cut.params.invert = "carve"; // a carved pipe: round, radius 8 -> carves 8 on the spine
  const r = evaluateField(resolveObjects([slab, cut]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(24 - 8, 1);
  expect(r.mask[px(r, 64, 64)]!).toBe(1); // carve still authors the mask
});

test("pos.z is base elevation: lifts the object, does not scale with extrude", () => {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(64, 64));
  dome.transform.pos = dome.transform.pos.withZ(10);
  dome.transform.scale = dome.transform.scale.withZ(0.5);
  const r = evaluateField(resolveObjects([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(10 + 24, 1); // elevation + 48*0.5
  expect(r.heightMap[px(r, 64 + 47, 64)]!).toBeGreaterThan(9.9); // near the rim: cliff at elevation
});

test("negative elevation sinks below the ground (negative Z allowed) and is masked", () => {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(64, 64));
  dome.transform.pos = dome.transform.pos.withZ(-60); // peak 48 - 60 = -12 at centre: fully below ground
  const r = evaluateField(resolveObjects([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(-12, 0); // sinks below the floor, no longer clipped to 0
  expect(r.mask[px(r, 64, 64)]!).toBe(1); // it changed the surface, so it IS masked
  expect(r.heightMap[px(r, 64 + 60, 64)]!).toBe(0); // outside the footprint: untouched ground
  dome.transform.pos = dome.transform.pos.withZ(-24); // half-buried: cap pokes out at center
  const r2 = evaluateField(resolveObjects([dome]), 128, 128);
  expect(r2.heightMap[px(r2, 64, 64)]!).toBeCloseTo(24, 1);
  expect(r2.mask[px(r2, 64, 64)]!).toBe(1);
});

test("scale.z scales the contribution (tallness)", () => {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(64, 64));
  dome.transform.scale = dome.transform.scale.withZ(0.5);
  const r = evaluateField(resolveObjects([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(24, 1);
});

test("transform: offset position and 2x scale", () => {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(32, 32));
  dome.transform.scale = new Vector3(2, 2, 1);
  const r = evaluateField(resolveObjects([dome]), 256, 256);
  // local rim at 48 -> canvas rim at 96 from center
  expect(r.heightMap[px(r, 32, 32)]!).toBeGreaterThan(23.9);
  expect(r.heightMap[px(r, 32 + 90, 32)]!).toBeGreaterThan(0);
  expect(r.heightMap[px(r, 32 + 100, 32)]!).toBe(0);
});


test("unknown typeId throws", () => {
  const ghost = { ...createObjectInstance(ObjectTypeId.Sphere, v2(0, 0)), typeId: "ghost" };
  expect(() => evaluateField(resolveObjects([ghost]), 8, 8)).toThrow(/unknown object type/);
});

test("per-object opacity: 0.5 halves the height contribution + the mask; 0 is inert", () => {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(64, 64));
  const full = evaluateField(resolveObjects([dome]), 128, 128).heightMap[px({ width: 128 }, 64, 64)]!;
  dome.opacity = 0.5;
  const r = evaluateField(resolveObjects([dome]), 128, 128);
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo(full / 2, 5);
  expect(r.mask[px(r, 64, 64)]!).toBeCloseTo(0.5, 5);
  dome.opacity = 0;
  const zero = evaluateField(resolveObjects([dome]), 128, 128);
  expect(zero.heightMap[px(zero, 64, 64)]!).toBe(0);
  expect(zero.mask[px(zero, 64, 64)]!).toBe(0);
});

test("per-object opacity lerps against the accumulated surface (half-opacity stud on a slab)", () => {
  const slab = createObjectInstance(ObjectTypeId.Plateau, v2(64, 64)); // 24px slab
  const stud = createObjectInstance(ObjectTypeId.Sphere, v2(64, 64)); // 48px dome on top
  stud.opacity = 0.5;
  const r = evaluateField(resolveObjects([slab, stud]), 128, 128);
  // slab surface 24, dome combined (max) = 48; half opacity -> midway = 36
  expect(r.heightMap[px(r, 64, 64)]!).toBeCloseTo((24 + 48) / 2, 0);
});
