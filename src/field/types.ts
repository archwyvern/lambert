import { Vector2 } from "@carapace/primitives";
import type { BezierAnchor } from "./bezier";
import type { Transform2D } from "./transform";
import type { CombineOp } from "./combine";

export interface ParamSpecPx {
  type: "px";
  default: number;
  min?: number;
  max?: number;
  /** Inspector scrub/step increment (default 1). Use a fraction for 0..1 sliders. */
  step?: number;
}

export interface ParamSpecEnum {
  type: "enum";
  options: string[];
  default: string;
}

export type ParamSpec = ParamSpecPx | ParamSpecEnum;

export interface ControlPointSpec {
  /** rings = two polygon rings in one array (base then top; counts differ via ringSplit).
   *  mesh = free triangulated surface; topology in ShapeInstance.mesh, xy in controlPoints. */
  kind: "none" | "polygon" | "polyline" | "rings" | "mesh";
  min?: number;
  /** Default control points in shape-local px. */
  default: Vector2[];
}

/** A mesh-plane's topology: per-vertex height (index-aligned with controlPoints) + triangles. */
export interface MeshData {
  /** Height in px at each vertex (scale.z multiplies, pos.z elevates — like every shape). */
  z: number[];
  /** Triangular FACES as triples of vertex indices into controlPoints. */
  tris: [number, number, number][];
  /** All connectivity edges (faces + loose) as undirected [lo,hi] pairs. Absent = derive from tris. */
  edges?: [number, number][];
  /** Transient per-vertex height gradient for the smoothness pass; computed per render, never stored. */
  grad?: [number, number][];
}

export interface ShapeInstance {
  id: string;
  typeId: string;
  /** User-given layer name; display falls back to the type name when absent. */
  name?: string;
  transform: Transform2D;
  params: Record<string, number | string | boolean>;
  controlPoints: Vector2[];
  /** Cable only: the cubic-Bézier pen path (anchors + tangent handles). controlPoints is the
   *  dense sample of it (what eval/GPU walk); editing the path regenerates controlPoints. */
  bezier?: BezierAnchor[];
  /** "rings" shapes (plateau): index where the top ring begins = base-ring vertex count.
   *  Absent = equal split (controlPoints.length / 2); lets inner/outer counts differ. */
  ringSplit?: number;
  /** When true, this shape's vertices + position snap to the ½-pixel grid on every edit. */
  gridSnap?: boolean;
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
  /** Library palette group (e.g. "Primitives", "Profiles"). Absent = ungrouped/hidden. */
  category?: string;
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
  /** Optional post-construction hook (createShapeInstance) — e.g. cable seeds its anchors and
   *  resamples them into the dense controlPoints. */
  onCreate?(shape: ShapeInstance): void;
  eval(pLocal: Vector2, shape: ShapeInstance): FieldSample;
}
