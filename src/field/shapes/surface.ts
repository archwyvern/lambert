import { defineShapeType } from "../registry";

/**
 * Surface: a direct-paint shape — pen-drawn polygonal faces, each filled with a flat color.
 * It carries no height (the no-op eval keeps it out of the height fold; packShapes skips it
 * because it has no WGSL) and is rendered/exported by the paint path, not the field pipeline.
 * Vertices live in controlPoints; faces (loops + colors) live in ShapeInstance.surface.
 */
export const Surface = defineShapeType({
  id: "surface",
  name: "Surface",
  params: {},
  controlPoints: { kind: "none", default: [] },
  eval: () => ({ height: 0, sd: 1e9 }), // never contributes to the height field
});

export const DEFAULT_SURFACE_COLOR = "#8080ff"; // neutral normal (flat, facing the viewer)
