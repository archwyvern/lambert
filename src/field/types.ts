import { Vector2 } from "@carapace/primitives";
import type { BezierAnchor } from "./bezier";
import type { Transform2D } from "./transform";
import type { CombineOp } from "./combine";

export interface ParamSpecPx {
  type: "px";
  default: number;
  min?: number;
  max?: number;
  /** Allow fractional values (inspector edits to 0.01 precision instead of whole numbers). The scrub
   *  increment itself is universal in carapace's SpinSlider (0.01 / Shift 0.1 / Ctrl 1.0), so there is
   *  no per-param step. */
  float?: boolean;
}

export interface ParamSpecEnum {
  type: "enum";
  options: string[];
  default: string;
  /** false = no generic record slot; the type's own `pack` hook encodes it (e.g. into a sign bit).
   *  Keeps a full type (Pillow: 2 params + 6 hole slots) from overflowing the 8-slot budget. */
  packed?: boolean;
}

export type ParamSpec = ParamSpecPx | ParamSpecEnum;

export interface ControlPointSpec {
  /** rings = two polygon rings in one array (base then top; counts differ via ringSplit).
   *  mesh = free triangulated surface; topology in ObjectInstance.mesh, xy in controlPoints. */
  kind: "none" | "polygon" | "polyline" | "rings" | "mesh";
  min?: number;
  /** Default control points in object-local px. */
  default: Vector2[];
}

/** One composable height transform hosted by an adjustment layer (see field/adjustments.ts). */
export interface Adjustment {
  id: string;
  /** Kind id in ADJUSTMENT_KINDS ("add" | "multiply" | "clamp" | "curve" | "ramp" | ...). */
  kind: string;
  /** Blend 0..1: out = mix(H, f(H), strength) — the fold-opacity lerp model. */
  strength: number;
  /** Absent = follow the project's adjustmentDefaults LIVE; present = fully overridden. */
  params?: Record<string, number>;
  /** Absent = active; false = bypassed (kept but not applied). */
  visible?: boolean;
}

/** A mesh-plane's topology: per-vertex height (index-aligned with controlPoints) + triangles. */
export interface MeshData {
  /** Height in px at each vertex (scale.z multiplies, pos.z elevates — like every object). */
  z: number[];
  /** Triangular FACES as triples of vertex indices into controlPoints. */
  tris: [number, number, number][];
  /** All connectivity edges (faces + loose) as undirected [lo,hi] pairs. Absent = derive from tris. */
  edges?: [number, number][];
  /** Transient per-vertex height gradient for the smoothness pass; computed per render, never stored. */
  grad?: [number, number][];
}

/** A pen-drawn closed-Bézier mask that trims its owner object. keep = object shows only inside the
 *  loop; cut = object is removed inside the loop. follow (default true) = anchors are in object-local
 *  space and ride the transform; false = anchors are pinned in canvas/doc space. */
export interface Mask {
  id: string;
  anchors: BezierAnchor[];
  mode: "keep" | "cut";
  follow: boolean;
  /** Absent = visible; false = disabled (kept in the doc but skipped by the fold, so it doesn't trim). */
  visible?: boolean;
  /** Engine-internal: a hard (non-anti-aliased) step at the loop edge instead of the ½px feather.
   *  Set only by the mirror SOURCE clip, so the seam is an exact cut with no half-pixel crossover. */
  hard?: boolean;
}

export interface ObjectInstance {
  id: string;
  typeId: string;
  /** User-given layer name; display falls back to the type name when absent. */
  name?: string;
  transform: Transform2D;
  params: Record<string, number | string | boolean>;
  controlPoints: Vector2[];
  /** Analytic vector paths (Cable/Ridge): the cubic-Bézier pen path (anchors + tangent
   *  handles), evaluated directly; controlPoints stays empty so the packer ships the anchors. */
  bezier?: BezierAnchor[];
  /** Bézier path is a closed loop (last anchor joins the first): an O-ring cable/ridge, and the basis
   *  for a filled vector outline. Open by default. */
  closed?: boolean;
  /** Anchor indices where each Bézier subpath (loop) begins; absent = a single path starting at 0.
   *  Used by Mesa (base + top ring) and Contour holes. */
  subpathStarts?: number[];
  /** Baked vertex count of each contour after baking the subpaths ([outer, hole1, hole2, ...] for a
   *  Contour; [base, top] for a Mesa). Set by the bake; drives the multi-contour
   *  hole CSG. Absent = a single contour. */
  contourCounts?: number[];
  /** "rings" objects (plateau): index where the top ring begins = base-ring vertex count.
   *  Absent = equal split (controlPoints.length / 2); lets inner/outer counts differ. */
  ringSplit?: number;
  /** Present only for Mesh objects (typeId ObjectTypeId.Mesh); aligns with controlPoints. */
  mesh?: MeshData;
  /** Per-object trim masks; each gates ONLY this object's influence. Absent = unmasked. */
  masks?: Mask[];
  /** Fold-contribution weight 0..1: 1/absent = full effect, 0 = inert. Lerps the object's height step
   *  into the accumulated surface and scales its mask influence (meaningful for carve/replace too). */
  opacity?: number;
  /** true = anti-aliased edge (box-filter coverage ramp on the NX mask); absent/false = HARD step at
   *  sd < 0 — the default, matching crisp sprite silhouettes. (An adjustment layer's region edge
   *  inherits this too.) */
  aa?: boolean;
  /** Adjustment layers only (typeId ObjectTypeId.Adjust): the ordered transform list applied to the
   *  height accumulated BELOW this layer, inside its region. */
  adjustments?: Adjustment[];
  visible: boolean;
  locked: boolean;
}

/** A group: a layer with a transform and children but no geometry of its own. Its transform is
 *  inherited by everything inside it. Non-uniform scale is allowed (resolved transforms are affine). */
export interface GroupLayer {
  kind: "group";
  id: string;
  name?: string;
  transform: Transform2D;
  visible: boolean;
  locked: boolean;
  /** Layers-panel collapse state (persisted). */
  collapsed?: boolean;
  /** Group-level trim masks (Phase 3). */
  masks?: Mask[];
  /** Symmetry about the group's local origin (Phase 4). */
  mirror?: "none" | "x" | "y" | "quad";
  /** Absent = on; false = mirror temporarily disabled (renders as a plain group, mode preserved). */
  mirrorEnabled?: boolean;
  children: LayerNode[];
}

/** A node in the layer tree: an object (leaf) or a group (subtree). */
export type LayerNode = ObjectInstance | GroupLayer;

/** Per-file canvas aids: a repositionable origin (creation point + ruler/display zero), guides, and
 *  guide lock + snap toggles. Coords are absolute texture pixels; the origin is displayed relative. */
export interface CanvasState {
  origin: { x: number; y: number };
  /** "v" = vertical guide line at x=at; "h" = horizontal guide line at y=at. */
  guides: { orient: "v" | "h"; at: number }[];
  guidesLocked: boolean;
  snapToGuides: boolean;
}

export function isGroup(n: LayerNode): n is GroupLayer {
  return (n as GroupLayer).kind === "group";
}
export function isObject(n: LayerNode): n is ObjectInstance {
  return (n as GroupLayer).kind !== "group";
}

export interface FieldSample {
  /** Height contribution in px at scale.z = 1 (pre elevation/extrude). */
  height: number;
  /** Signed distance to the footprint in object-local px (negative inside). */
  sd: number;
}

export interface ObjectType {
  id: string;
  name: string;
  /** Library palette group: "Shapes", "Paths", or "Special". Absent = ungrouped/hidden. */
  category?: string;
  params: Record<string, ParamSpec>;
  controlPoints: ControlPointSpec;
  /** carve = subtractive object (groove); everything else clips via max. */
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
  /** Optional post-construction hook (createObjectInstance) — e.g. cable seeds its anchors and
   *  resamples them into the dense controlPoints. */
  onCreate?(object: ObjectInstance): void;
  /** Optional record-packing hook, run AFTER the generic slots are written — for type-specific
   *  encodings (unpacked params, derived per-shape scalars in type-unused slots). */
  pack?(records: Float32Array, base: number, object: ObjectInstance): void;
  eval(pLocal: Vector2, object: ObjectInstance): FieldSample;
}
