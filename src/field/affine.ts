import { Vector2 } from "../math";
import type { Transform2D } from "./transform";
import { v2 } from "./vec";

/** A 2x3 affine map from object-local to world: world = (a*x + b*y + e, c*x + d*y + f).
 *
 *  Deliberately a plain POJO, not carapace `Transform2D`: this is packed field-by-field into the GPU
 *  object record (gpu/pack.ts) and applied in the per-pixel CPU eval hot loop (evalCpu.ts), so an
 *  immutable class with accessor chains would allocate and slow the inner loop. `affineFromTRS` also
 *  bakes a 3D TRS (z = elevation/tallness) that a flat 2D Transform2D has no slot for. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const affineIdentity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** Forward map of a TRS: local -> scale -> rotate -> translate (matches transform.fromLocal). */
export function affineFromTRS(t: Transform2D): Affine {
  const cr = Math.cos(t.rotation);
  const sr = Math.sin(t.rotation);
  return {
    a: cr * t.scale.x,
    b: -sr * t.scale.y,
    c: sr * t.scale.x,
    d: cr * t.scale.y,
    e: t.pos.x,
    f: t.pos.y,
  };
}

/** p ∘ q: the map that applies q first, then p. */
export function affineCompose(p: Affine, q: Affine): Affine {
  return {
    a: p.a * q.a + p.b * q.c,
    b: p.a * q.b + p.b * q.d,
    c: p.c * q.a + p.d * q.c,
    d: p.c * q.b + p.d * q.d,
    e: p.a * q.e + p.b * q.f + p.e,
    f: p.c * q.e + p.d * q.f + p.f,
  };
}

export function affineInvert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  const inv = det === 0 ? 0 : 1 / det; // degenerate transform collapses to the origin rather than NaN
  const a = m.d * inv;
  const b = -m.b * inv;
  const c = -m.c * inv;
  const d = m.a * inv;
  return { a, b, c, d, e: -(a * m.e + b * m.f), f: -(c * m.e + d * m.f) };
}

export function affineApply(m: Affine, p: Vector2): Vector2 {
  return v2(m.a * p.x + m.b * p.y + m.e, m.c * p.x + m.d * p.y + m.f);
}

/** Average of the two column norms — the scalar that converts a local distance to ~canvas px (the
 *  affine generalization of distanceScale; equals (|sx|+|sy|)/2 for a pure TRS). */
export function affineScaleHint(m: Affine): number {
  return (Math.hypot(m.a, m.c) + Math.hypot(m.b, m.d)) / 2;
}
