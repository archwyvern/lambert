import cableIcon from "./icons/cable.png";
import capsuleIcon from "./icons/capsule.png";
import coneIcon from "./icons/cone.png";
import cylinderIcon from "./icons/cylinder.png";
import domeIcon from "./icons/dome.png";
import filletIcon from "./icons/fillet.png";
import frustumIcon from "./icons/frustum.png";
import grooveIcon from "./icons/groove.png";
import plateauIcon from "./icons/plateau.png";
import pyramidIcon from "./icons/pyramid.png";
import torusIcon from "./icons/torus.png";
import wedgeIcon from "./icons/wedge.png";

/** Clay shape icons (blender/render_icons.py), keyed by shape type id. Shared by the Library
 *  palette and the Layers list. Types without an entry (e.g. mesh) render without an icon. */
export const SHAPE_ICONS: Record<string, string> = {
  dome: domeIcon,
  cone: coneIcon,
  pyramid: pyramidIcon,
  torus: torusIcon,
  plateau: plateauIcon,
  capsule: capsuleIcon,
  cylinder: cylinderIcon,
  frustum: frustumIcon,
  groove: grooveIcon,
  wedge: wedgeIcon,
  fillet: filletIcon,
  cable: cableIcon,
};
