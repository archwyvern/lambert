// Importing this module registers every built-in object type (side effect imports).
// Registration order = library palette order: Primitives, then Vectors, then Meshes.

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

// Meshes — the free triangulated height field (per-vertex Z); flat primitives bake into it (convert.ts).
export { Mesh } from "./mesh";

// Effects — adjustment-layer prototypes (QC-REQ-5); region-scoped field contributions.
export { Gradient } from "./gradient";

// Palette presets (familiar tiles backed by the parameterized types) — side-effect registration.
import "../presetDefs";
