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
  /** rings = two equal-count polygon rings in one array (first half base, second half top).
   *  mesh = free triangulated surface; topology in ShapeInstance.mesh, xy in controlPoints. */
  kind: "none" | "polygon" | "polyline" | "rings" | "mesh";
  min?: number;
  /** Default control points in shape-local px. */
  default: Vec2[];
}

/** A mesh-plane's topology: per-vertex height (index-aligned with controlPoints) + triangles. */
export interface MeshData {
  /** Height in px at each vertex (scale.z multiplies, pos.z elevates — like every shape). */
  z: number[];
  /** Triangles as triples of vertex indices into controlPoints. */
  tris: [number, number, number][];
}

export interface ShapeInstance {
  id: string;
  typeId: string;
  /** User-given layer name; display falls back to the type name when absent. */
  name?: string;
  transform: Transform2D;
  params: Record<string, number | string | boolean>;
  controlPoints: Vec2[];
  /** Present only for mesh-plane shapes (typeId "mesh"); aligns with controlPoints. */
  mesh?: MeshData;
  visible: boolean;
  locked: boolean;
}

export interface FieldSample {
  /** Height contribution in px at scale.z = 1 (pre elevation/extrude). */
  height: number;
  /** Signed distance to the footprint in shape-local px (negative inside). */
  sd: number;
}

export interface ShapeType {
  id: string;
  name: string;
  params: Record<string, ParamSpec>;
  controlPoints: ControlPointSpec;
  /** carve = subtractive shape (groove); everything else clips via max. */
  defaultCombine?: CombineOp;
  /** Intrinsic tallness in px at scale.z = 1 (extrude basis). */
  nominalHeight?: number;
  /** Hidden from the library palette even though it has WGSL (created by conversion). */
  libraryHidden?: boolean;
  /**
   * WGSL mirror of eval: `fn shape_<id>(p: vec2f, base: u32) -> vec2f` returning
   * (height, sd). Params read at base+13+declarationIndex; enums as option index.
   * Optional so test-only types can skip it; buildFoldWgsl() skips types without it.
   */
  wgsl?: string;
  eval(pLocal: Vec2, shape: ShapeInstance): FieldSample;
}
