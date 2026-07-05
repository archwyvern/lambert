// Importing this module registers every built-in object type (side effect imports).
// Registration order = library palette order: Primitives (Shapes), Vectors (Paths), then Special
// (Mesh + the Adjustment filter — neither is a preset shape).

// Primitives — parametric or straight-polygon footprints (no Bézier).
export { Sphere } from "./sphere";
export { Torus } from "./torus";
export { Ramp } from "./ramp";
export { Pipe } from "./pipe";
export { Berm } from "./berm";
export { Surface } from "./surface";
export { Plateau } from "./plateau";

// Vectors — Bézier paths (SVG model). Strokes: Cable = round tube, Ridge = flat-top
// embankment. Fills (closed, baked to a polygon): Contour.
export { PipeVector } from "./pipeVector";
export { BermVector } from "./bermVector";
export { SurfaceVector } from "./surfaceVector";
export { PlateauVector } from "./plateauVector";
export { Pillow } from "./pillow";

// Special — not preset shapes: the free triangulated Mesh (per-vertex Z; flat primitives bake into it
// via convert.ts) and the Adjustment FILTER layer (region-scoped transforms of the accumulated field).
export { Mesh } from "./mesh";
export { Adjust } from "./adjust";

// Palette presets (familiar tiles backed by the parameterized types) — side-effect registration.
import "../presetDefs";
