import type { Vector2 } from "@carapace/primitives";
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

/** Document-level inputs some kinds sample (threaded through the fold, absent when unused). */
export interface AdjustContext {
  /** Bilinear detail-band sample at a WORLD point (fine, medium, large) — see field/detail.ts. */
  sampleDetail?: (pw: Vector2) => [number, number, number];
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
    // Diffuse-luminance surface detail (the skyrat "Gradient" sense): adds the precomputed
    // multi-band detail field (field/detail.ts), weighted per band. amount is the height amplitude
    // in px — NEGATIVE inverts (dark-high instead of bright-high).
    params: {
      amount: { default: 6, float: true },
      fine: { default: 1, min: 0, float: true },
      medium: { default: 0.4, min: 0, float: true },
      large: { default: 0.15, min: 0, float: true },
    },
    apply: (H, p, _pl, pw, _region, ctx) => {
      if (!ctx.sampleDetail) return H;
      const [f, m, l] = ctx.sampleDetail(pw);
      return H + p("amount") * (f * p("fine") + m * p("medium") + l * p("large"));
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

/** A fresh adjustment of the kind, at default params and full strength. */
export function createAdjustment(kindId: string): Adjustment {
  const kind = byId.get(kindId);
  if (!kind) throw new Error(`unknown adjustment kind: ${kindId}`);
  return {
    id: crypto.randomUUID(),
    kind: kindId,
    strength: 1,
    params: Object.fromEntries(Object.entries(kind.params).map(([k, spec]) => [k, spec.default])),
  };
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
    const p = (key: string): number => {
      const v = a.params[key];
      return typeof v === "number" ? v : (kind.params[key]?.default ?? 0);
    };
    out = out + (kind.apply(out, p, pl, pw, region, ctx) - out) * clamp(a.strength, 0, 1) * cover;
  }
  return out;
}

/** Whether any (visible) adjustment layer in the tree hosts a "detail" adjustment — gates the
 *  detail-field precompute (the chain is skipped entirely for docs that never use it). */
export function layersUseDetail(layers: import("./types").LayerNode[]): boolean {
  for (const n of layers) {
    if ("children" in n && Array.isArray(n.children)) {
      if (!n.visible) continue;
      if (layersUseDetail(n.children)) return true;
    } else if ("adjustments" in n && n.visible) {
      if (n.adjustments?.some((a) => a.kind === "detail" && a.visible !== false)) return true;
    }
  }
  return false;
}
