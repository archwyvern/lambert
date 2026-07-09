import type { ViewMode, PointLight } from "./preview";

/**
 * Per-document view state: which preview mode is showing plus its transient lighting/opacity knobs.
 * Lives in its own module (not App) so the editor surface, the embed, and the various hooks can
 * share the type without importing the desktop shell.
 */
export interface ViewState {
  mode: ViewMode;
  /** Overlay opacity for the normal view (1 = 100%). */
  opacity: number;
  lightDir: [number, number, number];
  /** Lit view: light intensity multiplier (1 = default). */
  lightEnergy: number;
  /** Lit-preview point lights (2). Preview-only (never exported); transient like lightEnergy. */
  pointLights: PointLight[];
  /** The mode active before the current one — target of the "toggle last view" command (Shift+V).
   *  Transient, like lightEnergy: not in the session schema, backfilled from DEFAULT_VIEW per session. */
  prevMode?: ViewMode;
}

export const DEFAULT_VIEW: ViewState = {
  mode: "normal",
  opacity: 1,
  lightDir: [-0.5, -0.5, 0.7],
  lightEnergy: 1,
  prevMode: "diffuse",
  pointLights: [
    { on: false, x: 0.35, y: 0.4, height: 0.5, intensity: 0.8, color: [1.0, 0.85, 0.65] }, // warm key
    { on: false, x: 0.65, y: 0.6, height: 0.5, intensity: 0.8, color: [0.6, 0.78, 1.0] }, // cool fill
  ],
};
