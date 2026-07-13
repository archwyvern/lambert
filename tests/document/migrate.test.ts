import { expect, test } from "vitest";
import "../../src/field/objects";
import { Vector3 } from "@carapace/primitives";
import { addObject } from "../../src/document/docOps";
import { migrateDocToDims } from "../../src/document/migrate";
import { emptyDoc } from "../../src/document/schema";
import { isObject } from "../../src/field/types";
import { ObjectTypeId } from "../../src/field/registry";
import { v2 } from "../../src/field/vec";

const base = () => {
  let doc = emptyDoc("hull.df.png", 64, 32);
  doc = addObject(doc, ObjectTypeId.Sphere, v2(16, 8));
  doc = { ...doc, canvas: { ...doc.canvas, guides: [{ orient: "v" as const, at: 10 }, { orient: "h" as const, at: 20 }] } };
  return doc;
};

test("adopt keeps absolute positions, origin, and guides; only the canvas dims change", () => {
  const doc = base();
  const out = migrateDocToDims(doc, 128, 64, "adopt");
  expect(out.source.width).toBe(128);
  expect(out.source.height).toBe(64);
  expect(out.layers).toBe(doc.layers); // untouched
  expect(out.canvas).toBe(doc.canvas);
});

test("scale multiplies positions, node scale, origin, and guides by the factor", () => {
  const doc = base();
  const out = migrateDocToDims(doc, 128, 96, "scale"); // fx=2, fy=3
  const o = out.layers[0]!;
  expect(isObject(o)).toBe(true);
  expect(o.transform.pos).toEqual(new Vector3(32, 24, 0));
  expect(o.transform.scale.x).toBe(2);
  expect(o.transform.scale.y).toBe(3);
  expect(o.transform.scale.z).toBe(1); // height untouched
  expect(out.canvas.origin).toEqual({ x: 64, y: 48 }); // (32,16) * (2,3)
  expect(out.canvas.guides).toEqual([
    { orient: "v", at: 20 },
    { orient: "h", at: 60 },
  ]);
});
