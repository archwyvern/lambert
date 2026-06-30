import { z } from "zod";
import { defaultCanvas, docSchema, normalizeLayers, LambertDoc } from "./schema";
import { dropUnknownLayers } from "../field/registry";

/**
 * Session memory: the app continuously stashes the whole workspace — the open project, every
 * open document tab (its stable id, .lmb path, dirty flag, the doc itself with its source URI, and
 * per-tab view state), and which tab is active — into Electron userData, and restores it on the next
 * launch. Doubles as crash recovery: stashed (debounced) on every edit, so unsaved work survives a crash.
 */
const viewSchema = z.object({
  mode: z.enum(["diffuse", "normal", "lit"]).catch("lit"), // old "height" sessions fall back to lit
  opacity: z.number().min(0).max(1),
  lightDir: z.tuple([z.number(), z.number(), z.number()]),
  raster: z.boolean().catch(false),
});

const tabSchema = z.object({
  id: z.string().min(1),
  docPath: z.string().nullable(),
  dirty: z.boolean(),
  doc: docSchema,
  view: viewSchema,
  selectedId: z.string().nullable().catch(null), // restored on reopen so the selection survives
  // per-tab 2D pan/zoom; optional so old sessions (and never-fitted tabs) just re-fit on open
  viewport: z.object({ zoom: z.number(), panX: z.number(), panY: z.number() }).optional(),
  // per-tab 3D camera; optional so old sessions / never-orbited tabs open at the default framing
  orbit: z
    .object({
      yaw: z.number(),
      pitch: z.number(),
      dist: z.number(),
      target: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    })
    .optional(),
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
  for (const t of data.tabs) {
    const raw = t.doc as unknown as { layers?: unknown[] };
    t.doc.layers = dropUnknownLayers(
      normalizeLayers((raw.layers ?? []) as unknown[] as Parameters<typeof normalizeLayers>[0]),
    );
    t.doc.canvas = t.doc.canvas ?? defaultCanvas(t.doc.source.width, t.doc.source.height);
  }
  return data;
}
