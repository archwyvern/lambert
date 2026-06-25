import { expect, test } from "vitest";
import "../../src/field/objects";
import { createFromPreset, palettePresets } from "../../src/field/presets";
import { ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

test("createFromPreset: an explicit preset applies its params (cone = Sphere with a linear profile)", () => {
  const cone = createFromPreset("cone", v2(0, 0));
  expect(cone.typeId).toBe(ObjectTypeId.Sphere);
  expect(cone.params.profile).toBe("linear");
});

test("createFromPreset: identity tiles (no explicit preset) instantiate the bare type", () => {
  // these types have no explicit preset, so the palette emits an identity tile keyed by the type GUID;
  // createFromPreset must treat that id as the typeId (regression: it used to throw 'unknown preset').
  for (const id of [ObjectTypeId.Surface, ObjectTypeId.Torus, ObjectTypeId.SurfaceVector, ObjectTypeId.PlateauVector, ObjectTypeId.Mesh]) {
    expect(createFromPreset(id, v2(0, 0)).typeId).toBe(id);
  }
});

test("every palette tile can be instantiated (drag + double-click both go through createFromPreset)", () => {
  for (const p of palettePresets()) {
    expect(() => createFromPreset(p.id, v2(0, 0)), `tile ${p.name} (${p.id})`).not.toThrow();
    expect(createFromPreset(p.id, v2(0, 0)).typeId).toBe(p.typeId);
  }
});
