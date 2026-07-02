import { expect, test } from "vitest";
import "../../src/field/objects"; // register object types
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import { findNode } from "../../src/document/layerOps";
import { alignNodes, distributeNodes } from "../../src/ui/alignOps";
import { v2 } from "../../src/field/vec";

// same-type objects share a symmetric footprint, so footprint centre === pos and left edge is pos.x - r.
const sphere = (x: number, y: number) => createObjectInstance(ObjectTypeId.Sphere, v2(x, y));

test("align-left equalises the footprints' left edges (same pos.x for equal footprints)", () => {
  const a = sphere(0, 0);
  const b = sphere(100, 50);
  const out = alignNodes([a, b], [a.id, b.id], "left");
  expect(findNode(out, a.id)!.transform.pos.x).toBeCloseTo(findNode(out, b.id)!.transform.pos.x, 5);
});

test("align-hcenter centres both on the selection's centre-x", () => {
  const a = sphere(0, 0);
  const b = sphere(100, 0);
  const out = alignNodes([a, b], [a.id, b.id], "hcenter");
  expect(findNode(out, a.id)!.transform.pos.x).toBeCloseTo(50, 5);
  expect(findNode(out, b.id)!.transform.pos.x).toBeCloseTo(50, 5);
});

test("align-top leaves x untouched, equalises top edges", () => {
  const a = sphere(0, 0);
  const b = sphere(40, 80);
  const out = alignNodes([a, b], [a.id, b.id], "top");
  expect(findNode(out, a.id)!.transform.pos.x).toBeCloseTo(0, 5); // x unchanged
  expect(findNode(out, b.id)!.transform.pos.x).toBeCloseTo(40, 5);
  expect(findNode(out, a.id)!.transform.pos.y).toBeCloseTo(findNode(out, b.id)!.transform.pos.y, 5);
});

test("distribute-h evenly spaces the middle object's centre; extremes stay put", () => {
  const a = sphere(0, 0);
  const b = sphere(30, 0);
  const c = sphere(100, 0);
  const out = distributeNodes([a, b, c], [a.id, b.id, c.id], "h");
  expect(findNode(out, a.id)!.transform.pos.x).toBeCloseTo(0, 5); // extreme unchanged
  expect(findNode(out, c.id)!.transform.pos.x).toBeCloseTo(100, 5); // extreme unchanged
  expect(findNode(out, b.id)!.transform.pos.x).toBeCloseTo(50, 5); // midpoint
});

test("align is a no-op below 2 nodes; distribute below 3", () => {
  const a = sphere(0, 0);
  const b = sphere(30, 0);
  const single = [a];
  expect(alignNodes(single, [a.id], "left")).toBe(single); // returns the input array untouched
  const pair = [a, b];
  expect(distributeNodes(pair, [a.id, b.id], "h")).toBe(pair);
});
