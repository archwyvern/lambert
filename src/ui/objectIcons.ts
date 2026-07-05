import { ObjectTypeId } from "../field/objectTypeIds";
import bermIcon from "./icons/berm.png";
import cableIcon from "./icons/cable.png";
import contourIcon from "./icons/contour.png";
import adjustIcon from "./icons/adjust.svg"; // dedicated flat glyph — Adjustment is a filter, not clay geometry
import mesaIcon from "./icons/mesa.png";
import meshIcon from "./icons/mesh.png";
import pillowIcon from "./icons/pillow.png";
import pipeIcon from "./icons/pipe.png";
import plateIcon from "./icons/plate.png";
import plateauIcon from "./icons/plateau.png";
import rampIcon from "./icons/ramp.png";
import ridgeIcon from "./icons/ridge.png";
import sphereIcon from "./icons/sphere.png";
import torusIcon from "./icons/torus.png";

/** Clay object icons (blender/render_icons.py), keyed by object type GUID — one per type, matching
 *  the one-tile-per-type palette. Shared by the Library palette and the Layers list; Path types show
 *  their pen-drawn curved geometry so they read apart from their straight Shape cousins. */
export const OBJECT_ICONS: Record<string, string> = {
  // Shapes
  [ObjectTypeId.Sphere]: sphereIcon,
  [ObjectTypeId.Ramp]: rampIcon,
  [ObjectTypeId.Pipe]: pipeIcon,
  [ObjectTypeId.Berm]: bermIcon,
  [ObjectTypeId.Torus]: torusIcon,
  [ObjectTypeId.Plateau]: plateauIcon,
  [ObjectTypeId.Surface]: plateIcon,
  // Paths
  [ObjectTypeId.PipeVector]: cableIcon,
  [ObjectTypeId.BermVector]: ridgeIcon,
  [ObjectTypeId.SurfaceVector]: contourIcon,
  [ObjectTypeId.PlateauVector]: mesaIcon,
  [ObjectTypeId.Pillow]: pillowIcon,
  // Special (not shapes: the Adjustment filter + the free mesh)
  [ObjectTypeId.Adjust]: adjustIcon,
  [ObjectTypeId.Mesh]: meshIcon,
};
