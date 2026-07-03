import { Vector2, Vector3 } from "@carapace/primitives";
import { z } from "zod";
import type { CanvasState, LayerNode, ObjectInstance } from "../field/types";
import { dropUnknownLayers } from "../field/registry";

const vec2Schema = z.object({ x: z.number(), y: z.number() });
const bezierAnchorSchema = z.object({
  p: vec2Schema,
  hIn: vec2Schema,
  hOut: vec2Schema,
  mode: z.enum(["smooth", "manual"]).optional(),
  sym: z.boolean().optional(),
  /** Per-anchor cross-section multiplier (stroke taper); default 1. */
  scale: z.number().optional(),
  /** LEGACY (pre-scale): Cable per-anchor radius — migrated to `scale` on load. */
  radius: z.number().optional(),
});

const maskSchema = z.object({
  id: z.string(),
  anchors: z.array(bezierAnchorSchema),
  mode: z.enum(["keep", "cut"]),
  follow: z.boolean(),
  /** Absent = visible; false = disabled (the mask is kept but doesn't trim). */
  visible: z.boolean().optional(),
  /** true = hard (non-anti-aliased) edge; absent/false = soft ½px AA. New masks default hard. */
  hard: z.boolean().optional(),
});

// pos.z = base elevation (default 0); scale.z = extrude multiplier (default 1).
// Defaults keep pre-z documents loading unchanged.
const pos3Schema = z.object({ x: z.number(), y: z.number(), z: z.number().default(0) });
const scale3Schema = z.object({ x: z.number(), y: z.number(), z: z.number().default(1) });

const objectSchema = z.object({
  id: z.string(),
  typeId: z.string(),
  name: z.string().optional(),
  transform: z.object({
    pos: pos3Schema,
    rotation: z.number(),
    scale: scale3Schema,
  }),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  controlPoints: z.array(vec2Schema),
  /** Analytic vector paths (Cable/Ridge): the cubic-Bézier pen path. */
  bezier: z.array(bezierAnchorSchema).optional(),
  /** Bézier path is a closed loop (last anchor joins the first). Open by default. */
  closed: z.boolean().optional(),
  /** Anchor indices where each Bézier subpath begins (Mesa rings / Surface holes). */
  subpathStarts: z.array(z.number().int().nonnegative()).optional(),
  /** Baked per-contour vertex counts ([outer, ...holes] / [base, top]); drives the hole CSG. */
  contourCounts: z.array(z.number().int().nonnegative()).optional(),
  /** "rings" objects: base-ring vertex count (top ring is the rest). Absent = equal split. */
  ringSplit: z.number().int().positive().optional(),
  /** Mesh-plane topology (Mesh type only): per-vertex height + triangle indices. */
  mesh: z
    .object({
      z: z.array(z.number()),
      tris: z.array(z.tuple([z.number(), z.number(), z.number()])),
      edges: z.array(z.tuple([z.number(), z.number()])).optional(),
    })
    .optional(),
  /** Per-object trim masks (closed Bézier loops). */
  masks: z.array(maskSchema).optional(),
  /** Fold-contribution weight 0..1 (absent = 1). */
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean(),
  locked: z.boolean(),
});

// A group layer (transform + children, no geometry) and the recursive node union. Both are lazy so
// the mutual reference (a group's children are nodes) resolves at parse time.
const groupLayerSchema: z.ZodType = z.lazy(() =>
  z.object({
    kind: z.literal("group"),
    id: z.string(),
    name: z.string().optional(),
    transform: z.object({ pos: pos3Schema, rotation: z.number(), scale: scale3Schema }),
    visible: z.boolean(),
    locked: z.boolean(),
    collapsed: z.boolean().optional(),
    masks: z.array(maskSchema).optional(),
    mirror: z.enum(["none", "x", "y", "quad"]).optional(),
    mirrorEnabled: z.boolean().optional(),
    children: z.array(layerNodeSchema),
  }),
);
const layerNodeSchema: z.ZodType = z.lazy(() => z.union([groupLayerSchema, objectSchema]));

/** Which way the encoded channels point. Default: red right, green up. */
export interface NormalDirs {
  red: "right" | "left";
  green: "up" | "down";
}

export const DEFAULT_NORMAL_DIRS: NormalDirs = { red: "right", green: "up" };

/** Channel signs for image-space (y-down) normals: g = 0.5 + greenSign * n.y / 2. */
export function normalSigns(dirs: NormalDirs): { red: number; green: number } {
  return { red: dirs.red === "left" ? -1 : 1, green: dirs.green === "up" ? -1 : 1 };
}

const normalDirsSchema = z
  .object({
    red: z.enum(["right", "left"]).default("right"),
    green: z.enum(["up", "down"]).default("up"),
  })
  // factory, not the shared constant: a plain `.default(DEFAULT_NORMAL_DIRS)` hands every default-parse
  // the SAME object, so one in-place mutation would poison the module constant for all later parses
  .default(() => ({ ...DEFAULT_NORMAL_DIRS }));

/** Per-document override shape: no defaults — absent means "inherit the project setting". */
const normalDirsOverrideSchema = z.object({
  red: z.enum(["right", "left"]),
  green: z.enum(["up", "down"]),
});

// --- project file (project.lambert): folder-level config ---

/** The highest on-disk schema this build understands. Files above it were written by a newer Lambert. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Turn a newer-than-supported file into a clear "update Lambert" message instead of a raw zod
 *  "expected 1" error (which reads like corruption). Version 1 and malformed files fall through to
 *  the normal schema parse. */
function assertSupportedVersion(raw: unknown, kind: "project" | "document"): void {
  const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof v === "number" && v > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `This ${kind} was made by a newer version of Lambert (schema v${v}; this build supports ` +
        `v${SUPPORTED_SCHEMA_VERSION}). Update Lambert to open it.`,
    );
  }
}

/** A user-saved object preset: a serialized ObjectInstance used as a template (ids re-rolled and the
 *  position replaced on instantiation). Lives in project.lambert so it travels with the project; the
 *  File menu imports/exports these as a standalone .json library. */
export const savedPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  object: objectSchema,
});
export type SavedPreset = z.infer<typeof savedPresetSchema>;

/** The import/export envelope for a shared preset library file. */
export const presetLibrarySchema = z.object({
  schemaVersion: z.literal(1),
  presets: z.array(savedPresetSchema),
});

export const projectConfigSchema = z.object({
  schemaVersion: z.literal(1),
  normalDirs: normalDirsSchema,
  /** User-saved object presets (the palette's "Project" section). */
  presets: z.array(savedPresetSchema).optional(),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export function emptyProjectConfig(): ProjectConfig {
  return { schemaVersion: 1, normalDirs: { ...DEFAULT_NORMAL_DIRS } };
}

export function parseProjectConfig(json: string): ProjectConfig {
  const raw = JSON.parse(json);
  assertSupportedVersion(raw, "project");
  return projectConfigSchema.parse(raw);
}

export function serializeProjectConfig(config: ProjectConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

// --- per-image document (.lmb): one image's objects + view state ---

const canvasSchema = z.object({
  origin: z.object({ x: z.number(), y: z.number() }),
  guides: z.array(z.object({ orient: z.enum(["v", "h"]), at: z.number() })).default([]),
  guidesLocked: z.boolean().default(false),
  snapToGuides: z.boolean().default(false),
});

/** Default per-file canvas aids: origin at the texture centre, no guides, nothing locked/snapping. */
export function defaultCanvas(width: number, height: number): CanvasState {
  return { origin: { x: width / 2, y: height / 2 }, guides: [], guidesLocked: false, snapToGuides: false };
}

export const docSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    // The diffuse reference, as a URI: file:///abs/path or http(s)://… (resolved by diffuseSource).
    uri: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  layers: z.array(layerNodeSchema).optional(),
  canvas: canvasSchema.optional(),
  /** Per-document normal-channel override; absent = inherit the project's normalDirs. */
  normalDirs: normalDirsOverrideSchema.optional(),
});

export type LambertDoc = Omit<z.infer<typeof docSchema>, "layers" | "canvas"> & {
  layers: LayerNode[];
  canvas: CanvasState;
};

export function emptyDoc(uri: string, width: number, height: number): LambertDoc {
  return {
    schemaVersion: 1,
    source: { uri, width, height },
    layers: [],
    canvas: defaultCanvas(width, height),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- load-boundary glue over raw parsed JSON */

const hydrateVec2List = (xs: any[]): Vector2[] => xs.map((p) => new Vector2(p.x, p.y));
const hydrateAnchor = (a: any) => ({
  p: new Vector2(a.p.x, a.p.y),
  hIn: new Vector2(a.hIn.x, a.hIn.y),
  hOut: new Vector2(a.hOut.x, a.hOut.y),
  mode: a.mode,
  sym: a.sym,
  scale: a.scale,
  radius: a.radius, // legacy carry — hydrateObjectRaw migrates it to scale
});
const hydrateMask = (m: any) => ({ ...m, anchors: m.anchors.map(hydrateAnchor) });
const hydrateTransform = (t: any) => ({
  pos: new Vector3(t.pos.x, t.pos.y, t.pos.z),
  rotation: t.rotation,
  scale: new Vector3(t.scale.x, t.scale.y, t.scale.z),
});

/** Hydrate one plain-JSON object into a live ObjectInstance (real Vector2/3s). Exported for the saved
 *  preset templates (project.lambert), which store objects in the same serialized shape as .lmb. */
export function hydrateObjectRaw(s: any): ObjectInstance {
  let bezier = s.bezier?.map(hydrateAnchor);
  // LEGACY migration: pre-scale files stored a Cable taper as absolute per-anchor `radius`;
  // the model is now a relative per-anchor `scale` multiplier (radius_param · scale).
  if (bezier?.some((a: any) => typeof a.radius === "number")) {
    const base = typeof s.params?.radius === "number" && s.params.radius > 0 ? s.params.radius : 1;
    bezier = bezier.map(({ radius, ...a }: any) => (typeof radius === "number" ? { ...a, scale: radius / base } : a));
  } else {
    bezier = bezier?.map(({ radius: _radius, ...a }: any) => a);
  }
  return {
    ...s,
    transform: hydrateTransform(s.transform),
    controlPoints: hydrateVec2List(s.controlPoints),
    bezier,
    masks: s.masks?.map(hydrateMask),
  } as ObjectInstance;
}

/**
 * Hydrate plain {x,y} vectors into carapace Vector instances — recursively over the layer tree.
 * JSON.parse yields prototype-less objects; the runtime expects real Vector2/Vector3. Shared by
 * .lmb load and session restore; idempotent (reads .x/.y, safe on already-hydrated trees).
 */
export function normalizeLayers(raw: any[]): LayerNode[] {
  const out: LayerNode[] = [];
  for (const n of raw) {
    if (n?.kind === "group") {
      out.push({
        kind: "group",
        id: n.id,
        name: n.name,
        transform: hydrateTransform(n.transform),
        visible: n.visible,
        locked: n.locked,
        collapsed: n.collapsed,
        masks: n.masks?.map(hydrateMask),
        mirror: n.mirror,
        children: normalizeLayers(n.children),
      });
    } else {
      out.push(hydrateObjectRaw(n));
    }
  }
  return out;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Hydrate a schema-validated raw doc into a live LambertDoc: plain JSON -> live vectors
 *  (normalizeLayers, incl. the legacy anchor-radius migration), unknown object types dropped
 *  (graceful degrade for removed/newer types), canvas defaulted. The ONE hydration path — shared by
 *  .lmb parse and session-restore so the two can't drift. */
export function hydrateDoc(raw: {
  schemaVersion: LambertDoc["schemaVersion"];
  source: LambertDoc["source"];
  layers?: unknown;
  canvas?: CanvasState;
  normalDirs?: NormalDirs;
}): LambertDoc {
  return {
    schemaVersion: raw.schemaVersion,
    source: raw.source,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers: dropUnknownLayers(normalizeLayers(((raw.layers ?? []) as unknown[]) as any[])),
    canvas: raw.canvas ?? defaultCanvas(raw.source.width, raw.source.height),
    normalDirs: raw.normalDirs,
  };
}

/** The dirs a document actually renders/exports with: its own override, else the project's. */
export function effectiveNormalDirs(doc: Pick<LambertDoc, "normalDirs">, config: ProjectConfig): NormalDirs {
  return doc.normalDirs ?? config.normalDirs;
}

export function parseDoc(json: string): LambertDoc {
  const parsed = JSON.parse(json);
  assertSupportedVersion(parsed, "document");
  const raw = docSchema.parse(parsed);
  return hydrateDoc(raw as Parameters<typeof hydrateDoc>[0]);
}

export function serializeDoc(doc: LambertDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
