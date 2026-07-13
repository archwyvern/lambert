import { Vector2 } from "@aphralatrax/primitives";
import { allObjectTypes, createObjectInstance } from "./registry";
import type { ObjectInstance } from "./types";

/**
 * A palette entry: a named, icon'd configuration of an object type — param overrides (and optional
 * post-create setup) layered on a base type. This lets one parameterized type expose several familiar
 * tiles while staying DRY: e.g. the Sphere type backs Sphere (round) / Cone (linear) / Dome / Crater
 * presets; the Plateau type backs Plateau and Pyramid (single top vertex). The type registry stays
 * GUID-keyed (ObjectTypeId); presets are the palette-facing layer.
 */
export interface ObjectPreset {
  /** Stable id — the drag payload + onPick argument. */
  id: string;
  /** The ObjectTypeId this preset instantiates. */
  typeId: string;
  /** Display label + tooltip. */
  name: string;
  /** Palette group (Primitives / Vectors / Meshes). */
  category: string;
  /** Param overrides applied after creation. */
  params?: Record<string, number | string | boolean>;
  /** Further post-create setup (e.g. seed a specific path / control points). */
  setup?: (object: ObjectInstance) => void;
}

const presets: ObjectPreset[] = [];
const byId = new Map<string, ObjectPreset>();

export function definePreset(p: ObjectPreset): ObjectPreset {
  if (byId.has(p.id)) throw new Error(`duplicate preset: ${p.id}`);
  presets.push(p);
  byId.set(p.id, p);
  return p;
}

export function allPresets(): ObjectPreset[] {
  return presets;
}

export function getPreset(id: string): ObjectPreset {
  const p = byId.get(id);
  if (!p) throw new Error(`unknown preset: ${id}`);
  return p;
}

/** Instantiate a preset: the base type's instance, with the preset's param overrides + setup. An id
 *  with no registered preset is an IDENTITY tile (palettePresets emits one per un-merged type) — the id
 *  is the typeId itself, instantiated bare. */
export function createFromPreset(id: string, pos: Vector2): ObjectInstance {
  const preset = byId.get(id);
  const object = createObjectInstance(preset?.typeId ?? id, pos);
  if (preset?.params) Object.assign(object.params, preset.params);
  preset?.setup?.(object);
  return object;
}

/**
 * The palette entries, in type-registration order: a type's explicit presets if it has any, else an
 * identity preset (the bare type). So a merged type (Sphere) shows its presets (Sphere/Cone/…) while
 * an un-merged type still shows a single tile. Library-hidden / wgsl-less types are skipped.
 */
export function palettePresets(): ObjectPreset[] {
  const byType = new Map<string, ObjectPreset[]>();
  for (const p of presets) {
    const list = byType.get(p.typeId);
    if (list) list.push(p);
    else byType.set(p.typeId, [p]);
  }
  const out: ObjectPreset[] = [];
  for (const t of allObjectTypes()) {
    if (!t.wgsl || t.libraryHidden) continue;
    const explicit = byType.get(t.id);
    if (explicit) out.push(...explicit);
    else out.push({ id: t.id, typeId: t.id, name: t.name, category: t.category ?? "Other" });
  }
  return out;
}
