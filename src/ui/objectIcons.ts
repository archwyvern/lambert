import { ObjectTypeId } from "../field/objectTypeIds";
import bermIcon from "./icons/berm.png";
import capsuleIcon from "./icons/capsule.png";
import coneIcon from "./icons/cone.png";
import craterIcon from "./icons/crater.png";
import cylinderIcon from "./icons/cylinder.png";
import sphereIcon from "./icons/sphere.png";
import filletIcon from "./icons/fillet.png";
import frustumIcon from "./icons/frustum.png";
import gridIcon from "./icons/grid.png";
import loftIcon from "./icons/loft.png";
import meshIcon from "./icons/mesh.png";
import noiseIcon from "./icons/noise.png";
import revolveIcon from "./icons/revolve.png";
import plateauIcon from "./icons/plateau.png";
import polygonIcon from "./icons/polygon.png";
import pyramidIcon from "./icons/pyramid.png";
import torusIcon from "./icons/torus.png";
import wedgeIcon from "./icons/wedge.png";

/** Clay object icons (blender/render_icons.py), keyed by object type GUID. Shared by the Library
 *  palette and the Layers list. Types without an entry render without an icon. */
export const OBJECT_ICONS: Record<string, string> = {
  sphere: sphereIcon, // Sphere-type presets are keyed by preset id (slug), not the type GUID
  cone: coneIcon,
  crater: craterIcon,
  [ObjectTypeId.Torus]: torusIcon,
  wedge: wedgeIcon,
  fillet: filletIcon,
  cylinder: cylinderIcon, // Pipe-type presets keyed by preset id (slug)
  capsule: capsuleIcon,
  frustum: frustumIcon,
  [ObjectTypeId.Surface]: polygonIcon,
  plateau: plateauIcon, // Plateau-type presets keyed by preset id (slug)
  pyramid: pyramidIcon,
  [ObjectTypeId.Berm]: bermIcon,
  [ObjectTypeId.PipeVector]: cylinderIcon, // both pipes read as a cylinder
  [ObjectTypeId.BermVector]: bermIcon,
  [ObjectTypeId.SurfaceVector]: polygonIcon,
  [ObjectTypeId.PlateauVector]: plateauIcon,
  [ObjectTypeId.Mesh]: meshIcon,
  [ObjectTypeId.Grid]: gridIcon,
  [ObjectTypeId.Revolve]: revolveIcon,
  [ObjectTypeId.Loft]: loftIcon,
  [ObjectTypeId.Noise]: noiseIcon,
};
