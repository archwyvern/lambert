import { z } from "zod";
import { polygonStats } from "../field/controlPoints";
import type { ShapeInstance } from "../field/types";

const vec2Schema = z.object({ x: z.number(), y: z.number() });

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
  combine: z.object({
    blend: z.number().min(0),
    /** Legacy per-shape op; behavior now derives from the shape type. Ignored. */
    op: z.string().optional(),
  }),
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

export const docSchema = z.object({
  normalDirs: normalDirsSchema,
  schemaVersion: z.literal(1),
  source: z.object({
    path: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  shapes: z.array(shapeSchema),
  preview: z.object({
    lightDir: z.tuple([z.number(), z.number(), z.number()]),
    viewMode: z.enum(["diffuse", "height", "normal", "lit"]),
  }),
});

export type FlatlandDoc = z.infer<typeof docSchema> & { shapes: ShapeInstance[] };

export function emptyDoc(sourcePath: string, width: number, height: number): FlatlandDoc {
  return {
    schemaVersion: 1,
    normalDirs: { ...DEFAULT_NORMAL_DIRS },
    source: { path: sourcePath, width, height },
    shapes: [],
    preview: { lightDir: [-0.5, -0.5, 0.7071], viewMode: "lit" },
  };
}

/** Pre-elevation documents stored tallness as a px param; nominal = the old default. */
const LEGACY_TALLNESS: Record<string, { param: string; nominal: number }> = {
  plateau: { param: "height", nominal: 24 },
  dome: { param: "height", nominal: 24 },
  ridge: { param: "height", nominal: 16 },
  groove: { param: "depth", nominal: 8 },
};

export function parseDoc(json: string): FlatlandDoc {
  const doc = docSchema.parse(JSON.parse(json));
  for (const s of doc.shapes) {
    delete s.combine.op; // legacy per-shape op: the shape type owns the behavior now
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
    // legacy single-ring plateau: synthesize the top rim from slopeWidth (the straight-edge
    // inset matches via the apothem; the old SDF inset rounded corners, this miters them)
    if (s.typeId === "plateau" && typeof s.params.slopeWidth === "number") {
      const base = s.controlPoints;
      const { centroid, radius } = polygonStats(base);
      const apothem = radius * Math.cos(Math.PI / Math.max(base.length, 3));
      const k = Math.max(0.2, (apothem - s.params.slopeWidth) / Math.max(apothem, 1e-6));
      s.controlPoints = [
        ...base,
        ...base.map((v) => ({ x: centroid.x + (v.x - centroid.x) * k, y: centroid.y + (v.y - centroid.y) * k })),
      ];
      delete s.params.slopeWidth;
    }
  }
  return doc as unknown as FlatlandDoc;
}

export function serializeDoc(doc: FlatlandDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
