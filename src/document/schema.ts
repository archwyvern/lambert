import { z } from "zod";
import type { ShapeInstance } from "../field/types";

const vec2Schema = z.object({ x: z.number(), y: z.number() });

const shapeSchema = z.object({
  id: z.string(),
  typeId: z.string(),
  transform: z.object({
    pos: vec2Schema,
    rotation: z.number(),
    scale: vec2Schema,
  }),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  controlPoints: z.array(vec2Schema),
  combine: z.object({
    op: z.enum(["raise", "add", "carve"]),
    blend: z.number().min(0),
  }),
  strength: z.number(),
  visible: z.boolean(),
  locked: z.boolean(),
});

const docSchema = z.object({
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
    source: { path: sourcePath, width, height },
    shapes: [],
    preview: { lightDir: [-0.5, -0.5, 0.7071], viewMode: "lit" },
  };
}

export function parseDoc(json: string): FlatlandDoc {
  return docSchema.parse(JSON.parse(json)) as FlatlandDoc;
}

export function serializeDoc(doc: FlatlandDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
