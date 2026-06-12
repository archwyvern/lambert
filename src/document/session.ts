import { z } from "zod";
import { docSchema, dropRemovedShapes, LambertDoc } from "./schema";

/**
 * Session memory: the app continuously stashes the working document (saved or not),
 * its file pointers, and the view state into Electron userData, and restores all of it
 * on the next launch. Doubles as crash recovery — the stash is debounced on every edit.
 */
const sessionSchema = z.object({
  version: z.literal(1),
  docPath: z.string().nullable(),
  diffusePath: z.string().min(1),
  dirty: z.boolean(),
  view: z.object({
    mode: z.enum(["diffuse", "normal", "lit"]).catch("lit"), // old "height" sessions fall back to lit
    opacity: z.number().min(0).max(1),
    lightDir: z.tuple([z.number(), z.number(), z.number()]),
    raster: z.boolean().catch(false),
  }),
  doc: docSchema,
});

export type SessionData = z.infer<typeof sessionSchema> & { doc: LambertDoc };

export function buildSessionJson(s: Omit<SessionData, "version">): string {
  return JSON.stringify({ version: 1, ...s });
}

export function parseSessionJson(json: string): SessionData {
  const data = sessionSchema.parse(JSON.parse(json)) as SessionData;
  data.doc.shapes = dropRemovedShapes(data.doc.shapes);
  return data;
}
