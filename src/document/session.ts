import { z } from "zod";
import { docSchema, hydrateDoc, LambertDoc } from "./schema";

/**
 * Session memory: the app continuously stashes the whole workspace — the open project, every
 * open document tab (its stable id, .lmb path, dirty flag, the doc itself with its source URI, and
 * per-tab view state), and which tab is active — into Electron userData, and restores it on the next
 * launch. Doubles as crash recovery: stashed (debounced) on every edit, so unsaved work survives a crash.
 */
const viewSchema = z.object({
  mode: z.enum(["diffuse", "normal", "lit", "coverage"]).catch("lit"), // unknown/legacy modes fall back to lit
  opacity: z.number().min(0).max(1),
  lightDir: z.tuple([z.number(), z.number(), z.number()]),
  // a legacy `raster` field from before the vector/raster toggle was removed is simply ignored on load
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

// Envelope only: the tabs are validated one-by-one below, NOT as a single array. A hard
// `z.array(tabSchema)` made one corrupt tab reject the whole session — losing every restorable tab.
const sessionEnvelopeSchema = z.object({
  version: z.literal(1),
  projectPath: z.string().nullable(),
  activeIndex: z.number().int(),
  tabs: z.array(z.unknown()),
});

export type View = z.infer<typeof viewSchema>;
export type TabSession = Omit<z.infer<typeof tabSchema>, "doc"> & { doc: LambertDoc };
export interface SessionData {
  version: 1;
  projectPath: string | null;
  activeIndex: number;
  tabs: TabSession[];
}
/** Parse result: the session plus how many tabs were dropped as unparseable (for a restore notice). */
export interface ParsedSession extends SessionData {
  droppedTabs: number;
}

export function buildSessionJson(s: Omit<SessionData, "version">): string {
  return JSON.stringify({ version: 1, ...s });
}

export function parseSessionJson(json: string): ParsedSession {
  const env = sessionEnvelopeSchema.parse(JSON.parse(json));
  const tabs: TabSession[] = [];
  let droppedTabs = 0;
  for (const raw of env.tabs) {
    const parsed = tabSchema.safeParse(raw);
    if (!parsed.success) {
      droppedTabs += 1; // one bad tab must not sink the rest of a crash-recovery session
      continue;
    }
    const t = parsed.data as unknown as TabSession;
    t.doc = hydrateDoc(t.doc as unknown as Parameters<typeof hydrateDoc>[0]); // the shared .lmb hydration path
    tabs.push(t);
  }
  return { version: 1, projectPath: env.projectPath, activeIndex: env.activeIndex, tabs, droppedTabs };
}
