import type { Transform2D } from "./transform";
import type { Vec2 } from "./vec";
import type { CombineOp } from "./combine";

export interface ParamSpecPx {
  type: "px";
  default: number;
  min?: number;
  max?: number;
}

export interface ParamSpecEnum {
  type: "enum";
  options: string[];
  default: string;
}

export type ParamSpec = ParamSpecPx | ParamSpecEnum;

export interface ControlPointSpec {
  kind: "none" | "polygon" | "polyline";
  min?: number;
  /** Default control points in shape-local px. */
  default: Vec2[];
}

export interface CombineSpec {
  op: CombineOp;
  /** Smooth-blend radius in canvas px; 0 = hard. */
  blend: number;
}

export interface ShapeInstance {
  id: string;
  typeId: string;
  /** User-given layer name; display falls back to the type name when absent. */
  name?: string;
  transform: Transform2D;
  params: Record<string, number | string | boolean>;
  controlPoints: Vec2[];
  combine: CombineSpec;
  /** Scalar multiplier on the height contribution. */
  strength: number;
  visible: boolean;
  locked: boolean;
}

export interface FieldSample {
  /** Height contribution in px (pre-strength). */
  height: number;
  /** Signed distance to the footprint in shape-local px (negative inside). */
  sd: number;
}

export interface ShapeType {
  id: string;
  name: string;
  params: Record<string, ParamSpec>;
  controlPoints: ControlPointSpec;
  defaultCombine?: CombineOp;
  /**
   * WGSL mirror of eval: `fn shape_<id>(p: vec2f, base: u32) -> vec2f` returning
   * (height, sd). Params read at base+13+declarationIndex; enums as option index.
   * Optional so test-only types can skip it; buildFoldWgsl() skips types without it.
   */
  wgsl?: string;
  eval(pLocal: Vec2, shape: ShapeInstance): FieldSample;
}
