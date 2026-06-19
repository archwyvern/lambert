import { z } from "zod";
import { docSchema, dropRemovedShapes, hydrateShapes, LambertDoc } from "./schema";

/**
 * Session memory: the app continuously stashes the whole workspace — the open project, every
 * open image tab (its sidecar doc, file pointers, dirty flag, and per-image view state), and
 * which tab is active — into Electron userData, and restores it on the next launch. Doubles as
 * crash recovery: stashed (debounced) on every edit, so unsaved per-tab work survives a crash.
 */
const viewSchema = z.object({
  mode: z.enum(["diffuse", "normal", "lit"]).catch("lit"), // old "height" sessions fall back to lit
  opacity: z.number().min(0).max(1),
  lightDir: z.tuple([z.number(), z.number(), z.number()]),
  raster: z.boolean().catch(false),
});

const tabSchema = z.object({
  imagePath: z.string().min(1),
  docPath: z.string().nullable(),
  dirty: z.boolean(),
  doc: docSchema,
  view: viewSchema,
});

const sessionSchema = z.object({
  version: z.literal(1),
  projectPath: z.string().nullable(),
  activeIndex: z.number().int(),
  tabs: z.array(tabSchema),
});

export type View = z.infer<typeof viewSchema>;
export type TabSession = Omit<z.infer<typeof tabSchema>, "doc"> & { doc: LambertDoc };
export type SessionData = Omit<z.infer<typeof sessionSchema>, "tabs"> & { tabs: TabSession[] };

export function buildSessionJson(s: Omit<SessionData, "version">): string {
  return JSON.stringify({ version: 1, ...s });
}

export function parseSessionJson(json: string): SessionData {
  const data = sessionSchema.parse(JSON.parse(json)) as SessionData;
  for (const t of data.tabs) t.doc.shapes = hydrateShapes(dropRemovedShapes(t.doc.shapes));
  return data;
}
