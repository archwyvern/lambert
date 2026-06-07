import { z } from "zod";
import type { ShapeInstance } from "../field/types";

const vec2Schema = z.object({ x: z.number(), y: z.number() });

// z scales tallness; defaults keep pre-z documents loading unchanged
const scale3Schema = z.object({ x: z.number(), y: z.number(), z: z.number().default(1) });

const shapeSchema = z.object({
  id: z.string(),
  typeId: z.string(),
  name: z.string().optional(),
  transform: z.object({
    pos: vec2Schema,
    rotation: z.number(),
    scale: scale3Schema,
  }),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  controlPoints: z.array(vec2Schema),
  combine: z.object({
    // "raise" = legacy alias of max, migrated on load
    op: z.enum(["max", "add", "carve", "raise"]).transform((v) => (v === "raise" ? ("max" as const) : v)),
    blend: z.number().min(0),
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

export function parseDoc(json: string): FlatlandDoc {
  const doc = docSchema.parse(JSON.parse(json));
  for (const s of doc.shapes) {
    if (s.strength !== undefined) {
      s.transform.scale.z *= s.strength; // migrate legacy strength into tallness scale
      delete s.strength;
    }
  }
  return doc as unknown as FlatlandDoc;
}

export function serializeDoc(doc: FlatlandDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
