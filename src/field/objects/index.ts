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

// Vectors — Bézier paths (SVG model). Strokes: Pipe (Vector) = round tube, Berm (Vector) = flat-top
// embankment. Fills (closed, baked to a polygon): Surface (Vector).
export { PipeVector } from "./pipeVector";
export { BermVector } from "./bermVector";
export { SurfaceVector } from "./surfaceVector";
export { PlateauVector } from "./plateauVector";

// Meshes — triangulated height fields (per-vertex Z); differ only in their starting seed.
export { Mesh } from "./mesh";
export { Grid } from "./grid";
export { Revolve } from "./revolve";
export { Loft } from "./loft";
export { Noise } from "./noise";

// Palette presets (familiar tiles backed by the parameterized types) — side-effect registration.
import "../presetDefs";
