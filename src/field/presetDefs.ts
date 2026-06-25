import { ObjectTypeId } from "./objectTypeIds";
import { definePreset } from "./presets";
import { v2 } from "./vec";

/**
 * Palette presets — the familiar named tiles, each a parameterized configuration of a base type. This
 * is where merged types fan back out into their recognizable forms (round Sphere vs Cone vs Crater,
 * etc.). Types with no preset here fall back to a single identity tile (see palettePresets()).
 * Imported for its side effects by field/objects/index.ts.
 */

// Sphere (radial): profile picks the form.
definePreset({ id: "sphere", typeId: ObjectTypeId.Sphere, name: "Sphere", category: "Primitives", params: { profile: "round" } });
definePreset({ id: "cone", typeId: ObjectTypeId.Sphere, name: "Cone", category: "Primitives", params: { profile: "linear" } });
definePreset({ id: "crater", typeId: ObjectTypeId.Sphere, name: "Crater", category: "Primitives", params: { profile: "cove" } });

// Ramp (directional slope): linear = wedge, cove = fillet.
definePreset({ id: "wedge", typeId: ObjectTypeId.Ramp, name: "Wedge", category: "Primitives", params: { profile: "linear" } });
definePreset({ id: "fillet", typeId: ObjectTypeId.Ramp, name: "Fillet", category: "Primitives", params: { profile: "cove" } });

// Pipe (straight bar): cap + taper pick the form. Cylinder = flat cap, Capsule = round cap, Frustum = tapered.
definePreset({ id: "cylinder", typeId: ObjectTypeId.Pipe, name: "Cylinder", category: "Primitives", params: { cap: "flat" } });
definePreset({ id: "capsule", typeId: ObjectTypeId.Pipe, name: "Capsule", category: "Primitives", params: { cap: "round" } });
definePreset({ id: "frustum", typeId: ObjectTypeId.Pipe, name: "Frustum", category: "Primitives", params: { cap: "flat", radius2: 8 } });

// Plateau (base ring + top rim): default square top vs a single-apex pyramid.
definePreset({ id: "plateau", typeId: ObjectTypeId.Plateau, name: "Plateau", category: "Primitives" });
definePreset({
  id: "pyramid",
  typeId: ObjectTypeId.Plateau,
  name: "Pyramid",
  category: "Primitives",
  setup: (o) => {
    // a square base + a single top vertex (the apex) — Plateau's degenerate-top case
    o.controlPoints = [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32), v2(0, 0)];
    o.ringSplit = 4;
  },
});
