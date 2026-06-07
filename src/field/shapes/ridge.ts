import { PROFILE_KINDS, ProfileKind } from "../profiles";
import { defineShapeType, enumParam, numParam } from "../registry";
import { v2 } from "../vec";
import { spineEval } from "./spine";

export const Ridge = defineShapeType({
  id: "ridge",
  name: "Ridge",
  params: {
    height: { type: "px", default: 16, min: -256, max: 256 },
    width: { type: "px", default: 24, min: 1 },
    profile: { type: "enum", options: PROFILE_KINDS, default: "round" },
  },
  controlPoints: { kind: "polyline", min: 2, default: [v2(-32, 0), v2(32, 0)] },
  eval(p, shape) {
    return spineEval(
      p,
      shape.controlPoints,
      numParam(shape, "width") / 2,
      numParam(shape, "height"),
      enumParam(shape, "profile") as ProfileKind,
    );
  },
});
