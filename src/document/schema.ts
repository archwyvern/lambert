import { Vector2, Vector3 } from "@carapace/primitives";
import { z } from "zod";
import { polygonStats } from "../field/controlPoints";
import type { CanvasState, LayerNode, ShapeInstance } from "../field/types";

const vec2Schema = z.object({ x: z.number(), y: z.number() });
const bezierAnchorSchema = z.object({
  p: vec2Schema,
  hIn: vec2Schema,
  hOut: vec2Schema,
  mode: z.enum(["smooth", "manual"]).optional(),
  sym: z.boolean().optional(),
});

const maskSchema = z.object({
  id: z.string(),
  anchors: z.array(bezierAnchorSchema),
  mode: z.enum(["keep", "cut"]),
  follow: z.boolean(),
  /** Absent = visible; false = disabled (the mask is kept but doesn't trim). */
  visible: z.boolean().optional(),
});

// pos.z = base elevation (default 0); scale.z = extrude multiplier (default 1).
// Defaults keep pre-z documents loading unchanged.
const pos3Schema = z.object({ x: z.number(), y: z.number(), z: z.number().default(0) });
const scale3Schema = z.object({ x: z.number(), y: z.number(), z: z.number().default(1) });

const shapeSchema = z.object({
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
  /** Cable only: the cubic-Bézier pen path (controlPoints is its dense sample). */
  bezier: z.array(bezierAnchorSchema).optional(),
  /** "rings" shapes: base-ring vertex count (top ring is the rest). Absent = equal split. */
  ringSplit: z.number().int().positive().optional(),
  /** Mesh-plane topology (typeId "mesh" only): per-vertex height + triangle indices. */
  mesh: z
    .object({
      z: z.array(z.number()),
      tris: z.array(z.tuple([z.number(), z.number(), z.number()])),
      edges: z.array(z.tuple([z.number(), z.number()])).optional(),
    })
    .optional(),
  /** Per-shape trim masks (closed Bézier loops). */
  masks: z.array(maskSchema).optional(),
  /** Legacy combine settings (op/blend); behavior now derives from the shape type. */
  combine: z.unknown().optional(),
  /** Legacy height multiplier; folded into scale.z on load. */
  strength: z.number().optional(),
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
const layerNodeSchema: z.ZodType = z.lazy(() => z.union([groupLayerSchema, shapeSchema]));

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
  .default(DEFAULT_NORMAL_DIRS);

// --- project file (project.lambert): folder-level config ---

export const projectConfigSchema = z.object({
  schemaVersion: z.literal(1),
  normalDirs: normalDirsSchema,
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export function emptyProjectConfig(): ProjectConfig {
  return { schemaVersion: 1, normalDirs: { ...DEFAULT_NORMAL_DIRS } };
}

export function parseProjectConfig(json: string): ProjectConfig {
  return projectConfigSchema.parse(JSON.parse(json));
}

export function serializeProjectConfig(config: ProjectConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

// --- per-image document (.lnb): one image's shapes + view state ---

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
    path: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  // new docs use the layer tree; legacy docs carry a flat `shapes` list (normalized to layers on load)
  layers: z.array(layerNodeSchema).optional(),
  shapes: z.array(shapeSchema).optional(),
  canvas: canvasSchema.optional(),
});

export type LambertDoc = Omit<z.infer<typeof docSchema>, "shapes" | "layers" | "canvas"> & {
  layers: LayerNode[];
  canvas: CanvasState;
};

export function emptyDoc(sourcePath: string, width: number, height: number): LambertDoc {
  return {
    schemaVersion: 1,
    source: { path: sourcePath, width, height },
    layers: [],
    canvas: defaultCanvas(width, height),
  };
}

/** Pre-elevation documents stored tallness as a px param; nominal = the old default. */
const LEGACY_TALLNESS: Record<string, { param: string; nominal: number }> = {
  plateau: { param: "height", nominal: 24 },
  dome: { param: "height", nominal: 48 },
  capsule: { param: "height", nominal: 16 },
  groove: { param: "depth", nominal: 8 },
};

/** Shape type ids removed from the engine. Legacy documents that still carry them drop the
 *  orphaned leaves on load — their type is unregistered, so anything calling getShapeType on them
 *  (pack, render, picking) would throw. */
const REMOVED_TYPE_IDS = new Set(["surface"]);

/* eslint-disable @typescript-eslint/no-explicit-any -- load-boundary glue over raw parsed JSON */

/** Fold legacy per-shape fields (combine/strength/height/depth/radii/slopeWidth) into the current
 *  model. Mutates the raw (pre-hydrate) shape in place. */
function migrateRawShape(s: any): void {
  delete s.combine; // legacy combine settings: the shape type owns the behavior now
  if (s.strength !== undefined) {
    s.transform.scale.z *= s.strength; // legacy strength -> tallness scale
    delete s.strength;
  }
  const legacy = LEGACY_TALLNESS[s.typeId];
  if (legacy && typeof s.params[legacy.param] === "number") {
    s.transform.scale.z *= (s.params[legacy.param] as number) / legacy.nominal;
    delete s.params[legacy.param];
  }
  if (s.typeId === "dome") {
    if (typeof s.params.radiusX === "number") {
      s.transform.scale.x *= s.params.radiusX / 48;
      delete s.params.radiusX;
    }
    if (typeof s.params.radiusY === "number") {
      s.transform.scale.y *= s.params.radiusY / 48;
      delete s.params.radiusY;
    }
  }
  if (s.typeId === "plateau" && typeof s.params.slopeWidth === "number") {
    const base = s.controlPoints as { x: number; y: number }[];
    const { centroid, radius } = polygonStats(base.map((v) => new Vector2(v.x, v.y)));
    const apothem = radius * Math.cos(Math.PI / Math.max(base.length, 3));
    const k = Math.max(0.2, (apothem - s.params.slopeWidth) / Math.max(apothem, 1e-6));
    s.controlPoints = [
      ...base,
      ...base.map((v) => ({ x: centroid.x + (v.x - centroid.x) * k, y: centroid.y + (v.y - centroid.y) * k })),
    ];
    delete s.params.slopeWidth;
  }
}

/** ridge -> capsule rename: the old 2-point spine + width param becomes a parametric capsule, with
 *  the transform rotated to keep the spine's orientation. Returns a new raw shape. */
function ridgeToCapsule(s: any): any {
  if (s.typeId !== "ridge") return s;
  const a = s.controlPoints[0];
  const b = s.controlPoints[s.controlPoints.length - 1];
  const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) || 64 : 64;
  const angle = a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
  const radius = (Number(s.params.width) || 24) / 2;
  return {
    ...s,
    typeId: "capsule",
    params: { length, radius, profile: s.params.profile ?? "round" },
    controlPoints: [],
    transform: { ...s.transform, rotation: s.transform.rotation + angle },
  };
}

const hydrateVec2List = (xs: any[]): Vector2[] => xs.map((p) => new Vector2(p.x, p.y));
const hydrateAnchor = (a: any) => ({
  p: new Vector2(a.p.x, a.p.y),
  hIn: new Vector2(a.hIn.x, a.hIn.y),
  hOut: new Vector2(a.hOut.x, a.hOut.y),
  mode: a.mode,
  sym: a.sym,
});
const hydrateMask = (m: any) => ({ ...m, anchors: m.anchors.map(hydrateAnchor) });
const hydrateTransform = (t: any) => ({
  pos: new Vector3(t.pos.x, t.pos.y, t.pos.z),
  rotation: t.rotation,
  scale: new Vector3(t.scale.x, t.scale.y, t.scale.z),
});

function hydrateShapeRaw(s: any): ShapeInstance {
  return {
    ...s,
    transform: hydrateTransform(s.transform),
    controlPoints: hydrateVec2List(s.controlPoints),
    bezier: s.bezier?.map(hydrateAnchor),
    masks: s.masks?.map(hydrateMask),
  } as ShapeInstance;
}

/**
 * Drop removed-type leaves, fold legacy shape fields, rename ridge->capsule, and hydrate plain
 * {x,y} vectors into carapace Vector instances — recursively over the layer tree. JSON.parse yields
 * prototype-less objects; the runtime expects real Vector2/Vector3. Shared by .lambert load and
 * session restore; idempotent (reads .x/.y, safe on already-hydrated trees).
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
      if (REMOVED_TYPE_IDS.has(n.typeId)) continue;
      migrateRawShape(n);
      out.push(hydrateShapeRaw(ridgeToCapsule(n)));
    }
  }
  return out;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export function parseDoc(json: string): LambertDoc {
  const raw = docSchema.parse(JSON.parse(json));
  const layers = raw.layers ?? raw.shapes ?? [];
  return {
    schemaVersion: raw.schemaVersion,
    source: raw.source,
    layers: normalizeLayers(layers as unknown[] as any[]),
    canvas: raw.canvas ?? defaultCanvas(raw.source.width, raw.source.height),
  };
}

export function serializeDoc(doc: LambertDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
