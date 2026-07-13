import type { Vector2 } from "../math";
import type { Adjustment, ObjectInstance } from "./types";
import { clamp } from "./vec";

/**
 * Adjustment kinds — the composable, POINTWISE height transforms an adjustment layer hosts.
 * Pointwise (out depends only on the accumulated H and the sample point) keeps them
 * analytic-fold compatible: the GPU applies them per fragment inside fold_at with no
 * neighbourhood reads. Every adjustment blends by its strength: out = mix(H, f(H), strength) —
 * the same lerp model as fold opacity.
 *
 * Registry-based (code-registered defs, no factory classes). ORDER IS A GPU CONTRACT:
 * adjust_apply in gpu/wgsl.ts switches on these indices — append new kinds at the END and add a
 * matching case there. Params are numeric-only and capped at 4 (the packed stream carries
 * (kind, strength) + (p0, p1) + (p2, p3) per adjustment — see pack.ts).
 */

export interface AdjustmentParamSpec {
  default: number;
  min?: number;
  max?: number;
  float?: boolean;
}

/** Project-level default params per adjustment kind (sparse): kind id -> param -> value.
 *  Lives in project.lambert (ProjectConfig.adjustmentDefaults) — typed here because field/ must
 *  not import from document/. */
export type AdjustmentDefaults = Record<string, Record<string, number>>;

/** Document-level inputs some kinds sample (threaded through the fold, absent when unused). */
export interface AdjustContext {
  /** Bilinear detail-band sample at a WORLD point (fine, medium, large) — see field/detail.ts. */
  sampleDetail?: (pw: Vector2) => [number, number, number];
  /** Project default params for inheriting entries (absent = factory defaults). */
  defaults?: AdjustmentDefaults;
}

export interface AdjustmentKindDef {
  id: string;
  name: string;
  params: Record<string, AdjustmentParamSpec>;
  /** f(H): `p` reads a param by key (instance value, else default); `pl` is the REGION-local point
   *  (positional kinds like ramp); `pw` the world/doc point (texture-sampling kinds); `region` the
   *  hosting adjustment layer. */
  apply(H: number, p: (key: string) => number, pl: Vector2, pw: Vector2, region: ObjectInstance, ctx: AdjustContext): number;
}

export const ADJUSTMENT_KINDS: AdjustmentKindDef[] = [
  {
    id: "add",
    name: "Raise / Lower",
    params: { amount: { default: 8, float: true } },
    apply: (H, p) => H + p("amount"),
  },
  {
    id: "multiply",
    name: "Multiply",
    params: { factor: { default: 1.5, min: 0, float: true } },
    apply: (H, p) => H * p("factor"),
  },
  {
    id: "clamp",
    name: "Clamp",
    params: { min: { default: 0, float: true }, max: { default: 24, float: true } },
    apply: (H, p) => clamp(H, p("min"), p("max")),
  },
  {
    id: "curve",
    name: "Curve",
    // levels + gamma: heights in [low, high] remap through t^gamma (gamma < 1 lifts, > 1 crushes)
    params: { low: { default: 0, float: true }, high: { default: 24, float: true }, gamma: { default: 2, min: 0.1, max: 10, float: true } },
    apply: (H, p) => {
      const low = p("low");
      const span = Math.max(p("high") - low, 1e-6);
      const t = clamp((H - low) / span, 0, 1);
      return low + span * Math.pow(t, Math.max(p("gamma"), 1e-3));
    },
  },
  {
    id: "ramp",
    name: "Ramp",
    // the re-keyed Gradient effect: a directional height add, 0 -> depth across the region's own
    // extent along `angle` (region-local frame, so the region's transform rotates the ramp too)
    params: { angle: { default: 90, min: 0, max: 360, float: true }, depth: { default: 12, float: true } },
    apply: (H, p, pl, _pw, region) => {
      const a = (p("angle") * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const cps = region.controlPoints;
      const nB = region.contourCounts?.[0] ?? region.ringSplit ?? cps.length; // outer ring only
      let minP = Infinity;
      let maxP = -Infinity;
      for (let i = 0; i < Math.min(nB, cps.length); i++) {
        const t = cps[i]!.x * dx + cps[i]!.y * dy;
        minP = Math.min(minP, t);
        maxP = Math.max(maxP, t);
      }
      const t = clamp((pl.x * dx + pl.y * dy - minP) / Math.max(maxP - minP, 1e-6), 0, 1);
      return H + p("depth") * t;
    },
  },
  {
    id: "detail",
    name: "Emboss / Detail",
    // The skyrat Gradient stage, exactly (field/detail.ts): tolerance-gated Sobel of the diffuse
    // grayscale, blurred, integrated to height. radius/blur/tolerance are CHAIN params (the
    // precompute re-runs when they change); strength is a fold constant (default 0.25 = skyrat's
    // detailStrength) — NEGATIVE inverts (dark-high instead of bright-high).
    params: {
      radius: { default: 1, min: 1, max: 8 },
      strength: { default: 0.25, float: true },
      blur: { default: 1, min: 0, max: 10, float: true },
      tolerance: { default: 0.3, min: 0, max: 1, float: true },
    },
    apply: (H, p, _pl, pw, _region, ctx) => {
      if (!ctx.sampleDetail) return H;
      return H + p("strength") * ctx.sampleDetail(pw)[0];
    },
  },
];

const byId = new Map(ADJUSTMENT_KINDS.map((k) => [k.id, k]));

export function adjustmentKind(id: string): AdjustmentKindDef | undefined {
  return byId.get(id);
}

/** The GPU kind index (pack contract); -1 for unknown (the packer skips those). */
export function adjustmentKindIndex(id: string): number {
  return ADJUSTMENT_KINDS.findIndex((k) => k.id === id);
}

/** Effective param for an entry: instance override -> project default -> factory default. */
export function adjustmentParam(a: Adjustment, kind: AdjustmentKindDef, defaults: AdjustmentDefaults | undefined, key: string): number {
  const v = a.params?.[key];
  if (typeof v === "number") return v;
  const d = defaults?.[kind.id]?.[key];
  return typeof d === "number" ? d : (kind.params[key]?.default ?? 0);
}

/** A fresh adjustment of the kind at full strength — no params, so it INHERITS the project
 *  defaults live; params appear when the user flips its Override on. */
export function createAdjustment(kindId: string): Adjustment {
  const kind = byId.get(kindId);
  if (!kind) throw new Error(`unknown adjustment kind: ${kindId}`);
  return { id: crypto.randomUUID(), kind: kindId, strength: 1 };
}

/**
 * Apply an adjustment layer's list to the accumulated height, in order. `cover` is the region's
 * edge coverage × the layer's opacity (each adjustment's strength multiplies it). Hidden
 * (visible: false) and unknown-kind entries are skipped — mirrored by the GPU packer, which
 * simply doesn't pack them.
 */
export function applyAdjustments(
  H: number,
  adjustments: Adjustment[],
  pl: Vector2,
  pw: Vector2,
  region: ObjectInstance,
  cover: number,
  ctx: AdjustContext = {},
): number {
  let out = H;
  for (const a of adjustments) {
    if (a.visible === false) continue;
    const kind = byId.get(a.kind);
    if (!kind) continue;
    const p = (key: string): number => adjustmentParam(a, kind, ctx.defaults, key);
    out = out + (kind.apply(out, p, pl, pw, region, ctx) - out) * clamp(a.strength, 0, 1) * cover;
  }
  return out;
}

/** The chain params of the FIRST active "detail" adjustment in the tree, or null when none —
 *  gates the precompute AND keys its cache. One Emboss chain per document (matching skyrat,
 *  where it is a whole-image pass); additional detail entries reuse the same field. */
export function detailChainParams(layers: import("./types").LayerNode[], defaults?: AdjustmentDefaults): import("./detail").DetailParams | null {
  for (const n of layers) {
    if ("children" in n && Array.isArray(n.children)) {
      if (!n.visible) continue;
      const hit = detailChainParams(n.children, defaults);
      if (hit) return hit;
    } else if ("adjustments" in n && n.visible) {
      const a = n.adjustments?.find((x) => x.kind === "detail" && x.visible !== false);
      if (a) {
        const kind = byId.get("detail")!;
        const p = (key: string): number => adjustmentParam(a, kind, defaults, key);
        return { radius: p("radius"), blur: p("blur"), tolerance: p("tolerance") };
      }
    }
  }
  return null;
}
