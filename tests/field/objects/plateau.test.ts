import { expect, test } from "vitest";
import "../../../src/field/objects";
import { createObjectInstance, getObjectType, ObjectTypeId } from "../../../src/field/registry";
import { v2 } from "../../../src/field/vec";
import { bakeRings, bezierAnchor } from "../../../src/field/bezier";
import { mesaSeamRuns } from "../../../src/field/objects/plateauVector";

const plateau = getObjectType(ObjectTypeId.Plateau);
// defaults: base ring +/-32, top rim +/-20, height 24, profile linear
const inst = createObjectInstance(ObjectTypeId.Plateau, v2(0, 0));

test("flat top inside the top rim", () => {
  expect(plateau.eval(v2(0, 0), inst).height).toBeCloseTo(24);
  expect(plateau.eval(v2(10, 5), inst).height).toBeCloseTo(24);
  expect(plateau.eval(v2(20, 0), inst).height).toBeCloseTo(24); // on the rim edge
});

test("linear ramp across the slope band", () => {
  // p=(26,0): sdB = -6, sdT = 6 -> t = 0.5 -> 12
  expect(plateau.eval(v2(26, 0), inst).height).toBeCloseTo(12);
});

test("zero outside, sd positive outside (sd = footprint union; base ring is nearest here)", () => {
  const s = plateau.eval(v2(40, 0), inst);
  expect(s.height).toBe(0);
  expect(s.sd).toBeCloseTo(8);
});

test("dragging both rings moves the footprint and the flat top", () => {
  const stretched = {
    ...inst,
    controlPoints: [
      v2(-64, -32), v2(32, -32), v2(32, 32), v2(-64, 32),
      v2(-52, -20), v2(20, -20), v2(20, 20), v2(-52, 20),
    ],
  };
  expect(plateau.eval(v2(-58, 0), stretched).height).toBeCloseTo(12); // mid-band on the stretched side
  expect(plateau.eval(v2(-40, 0), stretched).height).toBeCloseTo(24); // inside the stretched top
});

test("corner crease: base vertex lofts straight to its paired top vertex", () => {
  // (26,26) on the loft line from base corner (32,32) to top corner (20,20), halfway -> t = 0.5
  expect(plateau.eval(v2(26, 26), inst).height).toBeCloseTo(12);
  // off-crease inside the right face: planar loft across the band -> t = 3/12
  expect(plateau.eval(v2(29, 0), inst).height).toBeCloseTo(24 * (3 / 12));
});

test("Mesa bakes two closed loops into base+top rings and ramps like Plateau", () => {
  const pv = createObjectInstance(ObjectTypeId.PlateauVector, v2(0, 0));
  expect(pv.subpathStarts).toEqual([0, 4]);
  expect(pv.ringSplit).toBeGreaterThan(0);
  const t = getObjectType(ObjectTypeId.PlateauVector);
  expect(t.eval(v2(0, 0), pv).height).toBeCloseTo(24, 0); // inside the top rim -> full height
  expect(t.eval(v2(50, 0), pv).height).toBeCloseTo(0); // outside the base
});

test("Mesa band is a flat chamfer: d8 soft-distance ratio, straight runs linear within 1%", () => {
  const pv = createObjectInstance(ObjectTypeId.PlateauVector, v2(0, 0));
  const mesa = getObjectType(ObjectTypeId.PlateauVector);
  // mid-side ray (band 32 -> 20, width 12): t = depth / 12, within 1% of full height (the d8
  // integral's finite-ring tails contribute ~0.2% — the d4 form bowed corners 6x worse and the
  // discrete forms creased/grooved; see mesaEval's header)
  expect(Math.abs(mesa.eval(v2(29, 0), pv).height - 24 * (3 / 12))).toBeLessThan(0.24);
  expect(Math.abs(mesa.eval(v2(26, 0), pv).height - 12)).toBeLessThan(0.24); // + tiny neighbor-face weight
  expect(Math.abs(mesa.eval(v2(23, 0), pv).height - 24 * (9 / 12))).toBeLessThan(0.24);
  // corner diagonal midpoint (26,26): between the old soft blend's scoop (t ~ 0.25) and the hard
  // miter (t = 6/(6+6*sqrt2) ~ 0.414) — the tight C-inf fillet. Pinned as a regression value.
  expect(mesa.eval(v2(26, 26), pv).height).toBeCloseTo(8.607, 2);
});

test("Mesa corner-to-corner seams: hard-corner pairs pin the face transitions", () => {
  const c = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
  const baseLoop = [c(20, 110), c(20, 40), c(45, 15), c(115, 15), c(115, 110)];
  const topLoop = [c(50, 80), c(44, 50), c(54, 40), c(95, 34), c(95, 80)];
  const bez = [...baseLoop, ...topLoop];
  const subs = [0, baseLoop.length];
  const r = bakeRings(bez, subs);
  const mk = (withBezier: boolean) => ({
    ...createObjectInstance(ObjectTypeId.PlateauVector, v2(0, 0)),
    controlPoints: r.controlPoints, ringSplit: r.ringSplit, contourCounts: r.contourCounts,
    bezier: withBezier ? bez : undefined, subpathStarts: withBezier ? subs : undefined,
  });
  const seamed = mk(true);
  // all-corner loops bake 1 point per anchor: run starts are the anchor indices themselves
  expect(mesaSeamRuns(seamed)).toEqual({ baseStarts: [0, 1, 2, 3, 4], topStarts: [0, 1, 2, 3, 4] });
  expect(mesaSeamRuns(mk(false))).toBeNull(); // no bezier -> global field fallback
  // the seam construction reshapes the field ONLY near the corner pairs: mid-face agrees with the
  // global field, corner neighborhoods move (that movement IS the corner-to-corner pinning)
  const mesa = getObjectType(ObjectTypeId.PlateauVector);
  const global = mk(false);
  const midFace = v2(32, 75); // interior of the left face, away from seams
  expect(Math.abs(mesa.eval(midFace, seamed).height - mesa.eval(midFace, global).height)).toBeLessThan(0.35);
  const nearSeam = v2(101, 84); // beside the bottom-right corner pair (max-diff point, measured)
  expect(Math.abs(mesa.eval(nearSeam, seamed).height - mesa.eval(nearSeam, global).height)).toBeGreaterThan(0.3);
});

test("Mesa crossed rim matches Plateau's angled-view rules (loft-hybrid skirt)", () => {
  const pv = createObjectInstance(ObjectTypeId.PlateauVector, v2(0, 0));
  const mesa = getObjectType(ObjectTypeId.PlateauVector);
  const crossedMesa = { ...pv, controlPoints: crossed.controlPoints, ringSplit: 4 };
  // inside the overhanging top rim, outside the base: the top hides (flat full height)
  expect(mesa.eval(v2(0, -38), crossedMesa).height).toBeCloseTo(24);
  expect(mesa.eval(v2(0, -38), crossedMesa).sd).toBeLessThan(0);
  // the corner sliver outside BOTH rings: the baked-ring loft skirt, same value as Plateau
  const sliver = mesa.eval(v2(-27, -36), crossedMesa);
  expect(sliver.height).toBeCloseTo(10);
  expect(sliver.sd).toBeLessThan(0);
  // outside everything: footprint follows the skirt (6px above the overhanging top edge)
  const out = mesa.eval(v2(0, -50), crossedMesa);
  expect(out.height).toBe(0);
  expect(out.sd).toBeCloseTo(6);
});

test("nested Mesa NEVER grows a skirt — concave rings with mismatched bakes stay clean", () => {
  // U-shaped base ring (notch opens at the top, x 10..20 above y 10) with a small nested top ring
  // in the left arm: the strip pairing shortcuts across the notch, and before the crossed gate its
  // triangles covered notch EXTERIOR points with skirt height. Nested rims must render as before.
  const pv = createObjectInstance(ObjectTypeId.PlateauVector, v2(0, 0));
  const mesa = getObjectType(ObjectTypeId.PlateauVector);
  const ushape = {
    ...pv,
    controlPoints: [
      v2(0, 0), v2(30, 0), v2(30, 30), v2(20, 30), v2(20, 10), v2(10, 10), v2(10, 30), v2(0, 30),
      v2(2, 2), v2(8, 2), v2(8, 8), v2(2, 8),
    ],
    ringSplit: 8,
  };
  const s = mesa.eval(v2(18, 22), ushape); // inside the notch (outside base), inside tri (B2,B3,T1)
  expect(s.height).toBe(0);
  expect(s.sd).toBeGreaterThan(0);
});

test("single top vertex makes a pyramid (apex at full height)", () => {
  const pyr = {
    ...inst,
    controlPoints: [v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32), v2(0, 0)],
    ringSplit: 4,
  };
  expect(plateau.eval(v2(0, 0), pyr).height).toBeCloseTo(24); // the apex
  expect(plateau.eval(v2(32, 0), pyr).height).toBeCloseTo(0); // base edge
  expect(plateau.eval(v2(16, 0), pyr).height).toBeCloseTo(12); // sdB -16, sdT 16 -> t 0.5
});

// crossed rims — the "angled view" rules: the top polygon hides what's under it, side faces render
// wherever their quads reach (even outside the base ring), footprint = rings + faces
const crossed = {
  ...inst,
  controlPoints: [
    v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32),
    // top rim's top edge dragged up past the base ring (y -44 < -32)
    v2(-20, -44), v2(20, -44), v2(20, 20), v2(-20, 20),
  ],
};

test("crossed rim: the top polygon renders flat even outside the base ring", () => {
  const s = plateau.eval(v2(0, -38), crossed); // inside top, outside base
  expect(s.height).toBeCloseTo(24);
  expect(s.sd).toBeLessThan(0);
  expect(plateau.eval(v2(0, 0), crossed).height).toBeCloseTo(24); // inside both, unchanged
});

test("crossed rim: side faces extend outside the base ring (the corner sliver)", () => {
  // (-27,-36) is outside BOTH rings but inside the folded left/back face triangles:
  // tri (base0, top3, top0) with heights (0,1,1) gives u+v = 5/12 -> 24 * 5/12 = 10
  const s = plateau.eval(v2(-27, -36), crossed);
  expect(s.height).toBeCloseTo(10);
  expect(s.sd).toBeLessThan(0);
});

test("crossed rim: footprint sd follows the union, not the base ring", () => {
  // (0,-50): 6px above the overhanging top edge (y=-44); the base ring alone is 18px away
  const s = plateau.eval(v2(0, -50), crossed);
  expect(s.height).toBe(0);
  expect(s.sd).toBeCloseTo(6);
});

test("skewed top rim tilts one slope without touching the other", () => {
  // top rim pushed +8 in x: the left band widens (shallower), the right narrows (steeper)
  const skewed = {
    ...inst,
    controlPoints: [
      v2(-32, -32), v2(32, -32), v2(32, 32), v2(-32, 32),
      v2(-12, -20), v2(28, -20), v2(28, 20), v2(-12, 20),
    ],
  };
  // left band spans -32..-12 (width 20): p=(-22,0) -> t = 0.5 -> 12
  expect(plateau.eval(v2(-22, 0), skewed).height).toBeCloseTo(12);
  // right band spans 28..32 (width 4): p=(30,0) -> t = 0.5 -> 12, but p=(26,0) is full height
  expect(plateau.eval(v2(30, 0), skewed).height).toBeCloseTo(12);
  expect(plateau.eval(v2(26, 0), skewed).height).toBeCloseTo(24);
});
