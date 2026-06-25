import { Affine, affineApply, affineCompose, affineFromTRS, affineIdentity, affineInvert, affineScaleHint } from "./affine";
import { bezierAnchor } from "./bezier";
import { isGroup } from "./types";
import type { GroupLayer, LayerNode, Mask, ObjectInstance } from "./types";
import { v2 } from "./vec";

/** A mask resolved for the fold: the same object as Mask plus a scope id. scope 0 = the object's own
 *  masks (follow as authored); scope >= 1 = an ancestor group's masks, baked to WORLD (follow=false).
 *  Coverage unions within a scope and multiplies across scopes (an object shows only where its own
 *  keeps AND every ancestor group's keeps keep it). */
export interface ResolvedMask extends Mask {
  scope: number;
}

/** An object resolved to world space: the geometry source plus the composed inverse transform, z, and
 *  scope-tagged masks. This is what the fold (evalCpu + pack) consumes instead of a raw ObjectInstance. */
export interface ResolvedObject {
  object: ObjectInstance;
  /** World -> object-local (composes every ancestor group + the object's own transform). */
  invAffine: Affine;
  /** Local distance -> canvas px (edge AA / mask feather). */
  scaleHint: number;
  /** Composed base elevation (sum of pos.z up the tree). */
  elevationZ: number;
  /** Composed tallness multiplier (product of scale.z up the tree). */
  tallnessZ: number;
  /** The object's own masks (scope 0) plus every ancestor group's masks baked to world (scopes 1+). */
  masks: ResolvedMask[];
}

/** Reflections about a group's LOCAL origin, used by mirror groups (Phase 4). */
const REFLECT = {
  x: { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 } as Affine, // negate x: reflect across the local Y axis
  y: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 } as Affine, // negate y: reflect across the local X axis
  xy: { a: -1, b: 0, c: 0, d: -1, e: 0, f: 0 } as Affine, // both: the diagonal corner
};

/** Far enough to cover any texture under any sane group scale; the seam edge (at local 0) is exact. */
const CLIP_FAR = 1e6;

/** The mirror's automatic SOURCE clip, as a keep mask in the group's local frame: a mirror only shows
 *  its source half (the negative side) — content crossing the axis is cut at the line, and the far
 *  side is purely the reflection. x => keep x<=0; y => keep y<=0; quad => keep the x<=0,y<=0 quadrant.
 *  Each emitted copy carries this in ITS OWN frame, so the base keeps the source and every reflected
 *  copy keeps the source side of its reflected frame = the mirror image on the far side. */
function mirrorClipMask(mode: GroupLayer["mirror"]): Mask {
  const xMax = mode === "y" ? CLIP_FAR : 0; // x unbounded for a pure-y mirror, else clipped at x=0
  const yMax = mode === "x" ? CLIP_FAR : 0; // y unbounded for a pure-x mirror, else clipped at y=0
  const pts = [v2(-CLIP_FAR, -CLIP_FAR), v2(xMax, -CLIP_FAR), v2(xMax, yMax), v2(-CLIP_FAR, yMax)];
  return { id: "mirror-clip", mode: "keep", follow: true, hard: true, anchors: pts.map((p) => bezierAnchor(p, v2(0, 0), v2(0, 0), "manual")) };
}

/** The affine set a mirror group emits its content through: identity plus the active reflections. */
function mirrorAffines(mode: GroupLayer["mirror"]): Affine[] {
  const I = affineIdentity();
  switch (mode) {
    case "x":
      return [I, REFLECT.x];
    case "y":
      return [I, REFLECT.y];
    case "quad":
      return [I, REFLECT.x, REFLECT.y, REFLECT.xy];
    default:
      return [I];
  }
}

/** A mask trims unless it's been disabled (visible === false). */
const shown = (m: Mask): boolean => m.visible !== false;

/** Bake a group mask into world space through `frame` (anchors are local; handles are offsets), so
 *  it tests as a world (follow=false) mask on every descendant. A pinned mask is already world. */
function worldBakeMask(m: Mask, frame: Affine, scope: number): ResolvedMask {
  if (!m.follow) return { ...m, scope };
  const anchors = m.anchors.map((a) => {
    const p = affineApply(frame, a.p);
    const out = affineApply(frame, v2(a.p.x + a.hOut.x, a.p.y + a.hOut.y));
    const inn = affineApply(frame, v2(a.p.x + a.hIn.x, a.p.y + a.hIn.y));
    return { ...a, p, hOut: v2(out.x - p.x, out.y - p.y), hIn: v2(inn.x - p.x, inn.y - p.y) };
  });
  return { ...m, follow: false, anchors, scope };
}

interface ScopeFrame {
  frame: Affine; // the group's world frame (with any active mirror folded in)
  masks: Mask[]; // the group's authored masks (group-local)
}

interface Ctx {
  affine: Affine; // accumulated forward affine of this node's PARENT frame (local -> world)
  elevation: number;
  tallness: number;
  scopes: ScopeFrame[]; // ancestor group mask scopes, outermost first
}

function walk(nodes: LayerNode[], ctx: Ctx, out: ResolvedObject[]): void {
  for (const n of nodes) {
    if (!n.visible) continue; // hidden subtree contributes nothing
    const fwd = affineCompose(ctx.affine, affineFromTRS(n.transform));
    const elevation = ctx.elevation + n.transform.pos.z;
    const tallness = ctx.tallness * n.transform.scale.z;
    if (isGroup(n)) {
      // a mirror group re-emits its whole subtree once per reflection; M folds into the frame so
      // nested groups + masks reflect too. mirror=none/disabled => [identity] = a plain group.
      const mirrored = !!n.mirror && n.mirror !== "none" && n.mirrorEnabled !== false;
      for (const M of mirrored ? mirrorAffines(n.mirror) : [affineIdentity()]) {
        const frame = affineCompose(fwd, M);
        let scopes = ctx.scopes;
        // auto SOURCE clip: each copy shows only the source side of its (reflected) frame, so content
        // crossing the axis is cut and the far side is a pure reflection (no manual mask needed).
        if (mirrored) scopes = [...scopes, { frame, masks: [mirrorClipMask(n.mirror)] }];
        const groupMasks = (n.masks ?? []).filter(shown);
        if (groupMasks.length) scopes = [...scopes, { frame, masks: groupMasks }];
        walk(n.children, { affine: frame, elevation, tallness, scopes }, out);
      }
    } else {
      const masks: ResolvedMask[] = (n.masks ?? []).filter(shown).map((m) => ({ ...m, scope: 0 }));
      ctx.scopes.forEach((sc, i) => sc.masks.forEach((m) => masks.push(worldBakeMask(m, sc.frame, i + 1))));
      out.push({
        object: n,
        invAffine: affineInvert(fwd),
        scaleHint: affineScaleHint(fwd),
        elevationZ: elevation,
        tallnessZ: tallness,
        masks,
      });
    }
  }
}

/** Resolve the layer tree to a flat, world-transformed object list (DFS order = z-order). Hidden
 *  subtrees are dropped. The fold consumes this instead of a raw ObjectInstance[]. */
export function flattenLayers(layers: LayerNode[]): ResolvedObject[] {
  const out: ResolvedObject[] = [];
  walk(layers, { affine: affineIdentity(), elevation: 0, tallness: 1, scopes: [] }, out);
  return out;
}

/** Wrap a flat object list as top-level layers and resolve — for tests, fixtures, and callers that
 *  don't (yet) have a tree. */
export function resolveObjects(objects: ObjectInstance[]): ResolvedObject[] {
  return flattenLayers(objects);
}
