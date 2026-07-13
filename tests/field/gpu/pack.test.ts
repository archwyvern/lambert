import { expect, test } from "vitest";
import "../../../src/field/objects";
import { createObjectInstance, ObjectTypeId } from "../../../src/field/registry";
import { createMask } from "../../../src/field/maskOps";
import { flattenLayers, resolveObjects } from "../../../src/field/flatten";
import { packObjects } from "../../../src/field/gpu/pack";
import { RECORD_F32 } from "../../../src/field/gpu/wgsl";
import { toLocal } from "../../../src/field/transform";
import { v2 } from "../../../src/field/vec";
import { Vector3 } from "@carapace/primitives";

test("dome record: layout offsets", () => {
  const dome = createObjectInstance(ObjectTypeId.Sphere, v2(10, 20));
  dome.transform.rotation = Math.PI / 2;
  dome.transform.scale = new Vector3(2, 4, 0.5);
  const { records, points, count } = packObjects(resolveObjects([dome]));
  expect(count).toBe(1);
  expect(records.length).toBe(RECORD_F32);
  expect(records[0]).toBe(0); // dome registered first -> typeIndex 0
  expect(records[1]).toBe(0); // op: dome clips (max)
  expect(records[3]).toBe(0.5); // scale.z (tallness)
  // slots 4..9 hold the inverse affine: local = (r4*x + r5*y + r8, r6*x + r7*y + r9)
  const localOf = (wx: number, wy: number): { x: number; y: number } => ({
    x: records[4]! * wx + records[5]! * wy + records[8]!,
    y: records[6]! * wx + records[7]! * wy + records[9]!,
  });
  for (const [wx, wy] of [
    [10, 20],
    [0, 0],
    [33, -7],
  ] as const) {
    const exp = toLocal(dome.transform, v2(wx, wy));
    const got = localOf(wx, wy);
    expect(got.x).toBeCloseTo(exp.x, 5);
    expect(got.y).toBeCloseTo(exp.y, 5);
  }
  expect(records[10]).toBeCloseTo(3); // distScale = (2+4)/2
  expect(records[11]).toBe(0); // cpStart
  expect(records[12]).toBe(0); // cpCount (dome has none)
  expect(records[21]).toBe(0); // elevation (pos.z)
  expect(points.length).toBe(2); // padded min one point
});

test("plateau: control points and enum param index", () => {
  const plateau = createObjectInstance(ObjectTypeId.Plateau, v2(0, 0));
  plateau.params.profile = "round";
  const { records, points } = packObjects(resolveObjects([plateau]));
  expect(records[12]).toBe(8); // 4 base + 4 top-rim vertices
  expect(records[13]).toBe(0); // profile "round" -> options index 0 (round, linear, cove, smooth)
  expect(points[0]).toBe(-32); // first base vertex x
  expect(points[1]).toBe(-32); // first base vertex y
  expect(points[8]).toBe(-20); // first top-rim vertex x
  expect(points.length).toBe(16);
});

test("multiple objects: cpStart advances, invisible skipped", () => {
  const a = createObjectInstance(ObjectTypeId.Plateau, v2(0, 0));
  const hidden = createObjectInstance(ObjectTypeId.Sphere, v2(0, 0));
  hidden.visible = false;
  const b = createObjectInstance(ObjectTypeId.PipeVector, v2(0, 0));
  const { records, count } = packObjects(resolveObjects([a, hidden, b]));
  expect(count).toBe(2);
  expect(records.length).toBe(2 * RECORD_F32);
  expect(records[RECORD_F32 + 11]).toBe(8); // pipe cpStart after plateau's 8 points
  expect(records[RECORD_F32 + 12]).toBe(2); // pipe path: 2 anchors
});

test("empty list still allocates non-empty buffers", () => {
  const { records, points, maskLoops, maskVerts, count } = packObjects(resolveObjects([]));
  expect(count).toBe(0);
  expect(records.length).toBeGreaterThan(0);
  expect(points.length).toBeGreaterThan(0);
  expect(maskLoops.length).toBeGreaterThan(0);
  expect(maskVerts.length).toBeGreaterThan(0);
});

test("masks: maskLoopStart/Count + vec4 header + verts per loop", () => {
  const s = createObjectInstance(ObjectTypeId.Sphere, v2(10, 10));
  s.masks = [
    { ...createMask([v2(0, 0), v2(4, 0), v2(4, 4), v2(0, 4)], true), mode: "keep" }, // 4 verts, follow
    { ...createMask([v2(1, 1), v2(2, 1), v2(2, 2)], false), mode: "cut" }, // 3 verts, world
  ];
  const { records, maskLoops, maskVerts } = packObjects(resolveObjects([s]));
  expect(records[24]).toBe(0); // maskLoopStart
  expect(records[25]).toBe(2); // maskLoopCount
  // loop 0 header: vec4(vertStart, vertCount, flags, scopeId)
  expect(maskLoops[0]).toBe(0); // vertStart
  expect(maskLoops[1]).toBe(4); // vertCount
  expect(maskLoops[2]).toBe(6); // keep(0) + follow(2) + hard(4) = 6 (createMask defaults hard)
  expect(maskLoops[3]).toBe(0); // scope 0 (object's own)
  // loop 1 header
  expect(maskLoops[4]).toBe(4); // vertStart (after loop 0's 4 verts)
  expect(maskLoops[5]).toBe(3); // vertCount
  expect(maskLoops[6]).toBe(5); // cut(1) + world(0) + hard(4) = 5
  expect(maskLoops[7]).toBe(0); // scope 0
  expect(maskVerts.length).toBe((4 + 3) * 2);
});

test("group mask: a child carries the group mask at scope 1 (world, follow bit clear)", () => {
  const child = createObjectInstance(ObjectTypeId.Sphere, v2(0, 0));
  child.masks = [{ ...createMask([v2(0, 0), v2(4, 0), v2(4, 4), v2(0, 4)], true), mode: "keep" }]; // scope 0
  const g = {
    kind: "group" as const,
    id: "g",
    transform: { pos: new Vector3(0, 0, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
    visible: true,
    locked: false,
    masks: [{ ...createMask([v2(0, 0), v2(8, 0), v2(8, 8), v2(0, 8)], true), mode: "keep" as const }],
    children: [child],
  };
  const { records, maskLoops } = packObjects(flattenLayers([g]));
  expect(records[25]).toBe(2); // 2 loops: object's own + the group's
  expect(maskLoops[3]).toBe(0); // loop 0 scope 0 (object's own)
  expect(maskLoops[7]).toBe(1); // loop 1 scope 1 (group mask)
  expect(maskLoops[6]! & 2).toBe(0); // group mask baked to world -> follow bit clear
});
