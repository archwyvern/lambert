import cableIcon from "./icons/cable.png";
import coneIcon from "./icons/cone.png";
import domeIcon from "./icons/dome.png";
import filletIcon from "./icons/fillet.png";
import grooveIcon from "./icons/groove.png";
import plateauIcon from "./icons/plateau.png";
import pyramidIcon from "./icons/pyramid.png";
import ridgeIcon from "./icons/ridge.png";
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
  ridge: ridgeIcon,
  groove: grooveIcon,
  wedge: wedgeIcon,
  fillet: filletIcon,
  cable: cableIcon,
};
