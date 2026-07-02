import { expect, test } from "vitest";
import "../../src/field/objects";
import { createFromPreset, palettePresets } from "../../src/field/presets";
import { plateauEval } from "../../src/field/objects/plateau";
import { ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

test("createFromPreset: identity tiles (no explicit preset) instantiate the bare type", () => {
  // one tile per type: profile/cap variants are Inspector dropdowns, not tiles. The palette emits an
  // identity tile keyed by the type GUID; createFromPreset must treat that id as the typeId
  // (regression: it used to throw 'unknown preset').
  for (const id of [ObjectTypeId.Sphere, ObjectTypeId.Ramp, ObjectTypeId.Pipe, ObjectTypeId.Plateau, ObjectTypeId.Surface, ObjectTypeId.Torus, ObjectTypeId.SurfaceVector, ObjectTypeId.PlateauVector, ObjectTypeId.Mesh]) {
    expect(createFromPreset(id, v2(0, 0)).typeId).toBe(id);
  }
});

test("the palette is strictly one tile per type (no explicit presets)", () => {
  expect(palettePresets().filter((p) => p.id !== p.typeId)).toEqual([]);
});

test("every palette tile can be instantiated (drag + double-click both go through createFromPreset)", () => {
  for (const p of palettePresets()) {
    expect(() => createFromPreset(p.id, v2(0, 0)), `tile ${p.name} (${p.id})`).not.toThrow();
    expect(createFromPreset(p.id, v2(0, 0)).typeId).toBe(p.typeId);
  }
});

test("plateau with top rim === base ring is a box: full-height flat top + vertical walls", () => {
  // the ex-Box template's geometry (the palette tile was dropped — one tile per type); the degenerate
  // base==top loft must stay a clean vertical step, not a slope band
  const box = createFromPreset(ObjectTypeId.Plateau, v2(0, 0));
  box.controlPoints = [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32), v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32)];
  box.ringSplit = 4;
  expect(plateauEval(v2(0, 0), box).height).toBeCloseTo(24, 3); // interior at full nominal height
  expect(plateauEval(v2(0, 0), box).sd).toBeLessThan(0); // inside the footprint
  expect(plateauEval(v2(200, 200), box).height).toBeCloseTo(0, 3); // exterior flat
});
