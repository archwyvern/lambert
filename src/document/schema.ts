import { Vector2, Vector3 } from "@carapace/primitives";
import { z } from "zod";
import { polygonStats } from "../field/controlPoints";
import type { ShapeInstance } from "../field/types";

const vec2Schema = z.object({ x: z.number(), y: z.number() });
const bezierAnchorSchema = z.object({
  p: vec2Schema,
  hIn: vec2Schema,
  hOut: vec2Schema,
  mode: z.enum(["smooth", "manual"]).optional(),
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
  /** Per-shape ½px grid snap for vertices + position (authoring aid). */
  gridSnap: z.boolean().optional(),
  /** Mesh-plane topology (typeId "mesh" only): per-vertex height + triangle indices. */
  mesh: z
    .object({
      z: z.array(z.number()),
      tris: z.array(z.tuple([z.number(), z.number(), z.number()])),
      edges: z.array(z.tuple([z.number(), z.number()])).optional(),
    })
    .optional(),
  /** Legacy combine settings (op/blend); behavior now derives from the shape type. */
  combine: z.unknown().optional(),
  /** Legacy height multiplier; folded into scale.z on load. */
  strength: z.number().optional(),
  visible: z.boolean(),
  locked: z.boolean(),
});

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

export const docSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    path: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  shapes: z.array(shapeSchema),
  preview: z.object({
    lightDir: z.tuple([z.number(), z.number(), z.number()]),
    viewMode: z.enum(["diffuse", "normal", "lit"]).catch("lit"),
  }),
});

export type LambertDoc = Omit<z.infer<typeof docSchema>, "shapes"> & { shapes: ShapeInstance[] };

export function emptyDoc(sourcePath: string, width: number, height: number): LambertDoc {
  return {
    schemaVersion: 1,
    source: { path: sourcePath, width, height },
    shapes: [],
    preview: { lightDir: [-0.5, -0.5, 0.7071], viewMode: "lit" },
  };
}

/** Pre-elevation documents stored tallness as a px param; nominal = the old default. */
const LEGACY_TALLNESS: Record<string, { param: string; nominal: number }> = {
  plateau: { param: "height", nominal: 24 },
  dome: { param: "height", nominal: 48 },
  ridge: { param: "height", nominal: 16 },
  groove: { param: "depth", nominal: 8 },
};

/** Shape type ids removed from the engine. Legacy documents that still carry them drop the
 *  orphaned shapes on load — their type is unregistered, so anything calling getShapeType on
 *  them (pack, render, picking) would throw. Shared by .lambert load and session restore. */
const REMOVED_TYPE_IDS = new Set(["surface"]);

export function dropRemovedShapes(shapes: ShapeInstance[]): ShapeInstance[] {
  return shapes.filter((s) => !REMOVED_TYPE_IDS.has(s.typeId));
}

/**
 * Convert a freshly-parsed document's plain {x,y}/{x,y,z} vectors into carapace Vector
 * instances. JSON.parse yields prototype-less plain objects; the runtime model expects real
 * Vector2/Vector3 (with methods), so every load boundary (.lambert and session restore) must
 * run this. Reads .x/.y/.z, so it is idempotent — safe on already-hydrated shapes too.
 */
export function hydrateShapes(shapes: ShapeInstance[]): ShapeInstance[] {
  return shapes.map((s) => ({
    ...s,
    transform: {
      pos: new Vector3(s.transform.pos.x, s.transform.pos.y, s.transform.pos.z),
      rotation: s.transform.rotation,
      scale: new Vector3(s.transform.scale.x, s.transform.scale.y, s.transform.scale.z),
    },
    controlPoints: s.controlPoints.map((p) => new Vector2(p.x, p.y)),
    bezier: s.bezier?.map((a) => ({
      p: new Vector2(a.p.x, a.p.y),
      hIn: new Vector2(a.hIn.x, a.hIn.y),
      hOut: new Vector2(a.hOut.x, a.hOut.y),
      mode: a.mode,
    })),
  }));
}

export function parseDoc(json: string): LambertDoc {
  const doc = docSchema.parse(JSON.parse(json));
  for (const s of doc.shapes) {
    delete s.combine; // legacy combine settings: the shape type owns the behavior now
    if (s.strength !== undefined) {
      s.transform.scale.z *= s.strength; // migrate legacy strength into tallness scale
      delete s.strength;
    }
    // legacy tallness params (height/depth) fold into the extrude multiplier
    const legacy = LEGACY_TALLNESS[s.typeId];
    if (legacy && typeof s.params[legacy.param] === "number") {
      s.transform.scale.z *= (s.params[legacy.param] as number) / legacy.nominal;
      delete s.params[legacy.param];
    }
    // legacy dome radii fold into the footprint scale (nominal radius 48)
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
    // legacy single-ring plateau: synthesize the top rim from slopeWidth (the straight-edge
    // inset matches via the apothem; the old SDF inset rounded corners, this miters them)
    if (s.typeId === "plateau" && typeof s.params.slopeWidth === "number") {
      const base = s.controlPoints;
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
  const migrated = doc as unknown as LambertDoc;
  migrated.shapes = hydrateShapes(dropRemovedShapes(migrated.shapes));
  return migrated;
}

export function serializeDoc(doc: LambertDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
