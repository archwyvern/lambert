import { expect, test } from "vitest";
import "../../../src/field/objects";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";

// The mesh generators (Grid/Revolve/Loft/Noise) all share Mesh's field eval; they differ only in
// the seed onCreate produces. Verify each seeds a non-degenerate, evaluable mesh.

const MESH_TYPES = [ObjectTypeId.Grid, ObjectTypeId.Revolve, ObjectTypeId.Loft, ObjectTypeId.Noise];

test("every mesh generator seeds a triangulated, evaluable surface", () => {
  for (const id of MESH_TYPES) {
    const inst = createObjectInstance(id, v2(0, 0));
    expect(inst.mesh, id).toBeDefined();
    expect(inst.mesh!.tris.length).toBeGreaterThan(0);
    expect(inst.controlPoints.length).toBe(inst.mesh!.z.length);
    // inside the footprint the surface evaluates (sd <= 0); the eval never throws
    const s = getObjectType(id).eval(v2(0, 0), inst);
    expect(Number.isFinite(s.height)).toBe(true);
  }
});

test("Grid seeds flat (z=0 everywhere); Revolve domes up at the centre", () => {
  const grid = createObjectInstance(ObjectTypeId.Grid, v2(0, 0));
  expect(Math.max(...grid.mesh!.z)).toBe(0);

  const rev = createObjectInstance(ObjectTypeId.Revolve, v2(0, 0));
  const centreH = getObjectType(ObjectTypeId.Revolve).eval(v2(0, 0), rev).height;
  const edgeH = getObjectType(ObjectTypeId.Revolve).eval(v2(30, 0), rev).height;
  expect(centreH).toBeGreaterThan(edgeH); // dome: taller at the centre than near the rim
});

test("Noise seeds a non-flat field", () => {
  const noise = createObjectInstance(ObjectTypeId.Noise, v2(0, 0));
  const zs = noise.mesh!.z;
  expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1); // actual relief, not flat
});
