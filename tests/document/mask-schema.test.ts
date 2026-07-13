import { describe, expect, it } from "vitest";
import "../../src/field/objects"; // register object types (parseDoc drops unknown typeIds)
import { ObjectTypeId } from "../../src/field/objectTypeIds";
import { Vector2, Vector3 } from "../../src/math";
import { parseDoc, serializeDoc } from "../../src/document/schema";
import type { LambertDoc } from "../../src/document/schema";
import type { ObjectInstance } from "../../src/field/types";

const baseDoc = (): LambertDoc => ({
  schemaVersion: 1,
  source: { uri: "a.png", width: 8, height: 8 },
  canvas: { origin: { x: 4, y: 4 }, guides: [], guidesLocked: false, snapToGuides: false },
  layers: [
    {
      id: "s1",
      typeId: ObjectTypeId.Sphere,
      transform: { pos: new Vector3(4, 4, 0), rotation: 0, scale: new Vector3(1, 1, 1) },
      params: {},
      controlPoints: [],
      visible: true,
      locked: false,
      masks: [
        {
          id: "m1",
          mode: "keep",
          follow: true,
          anchors: [
            { p: new Vector2(-2, -2), hIn: new Vector2(0, 0), hOut: new Vector2(0, 0), mode: "manual" },
            { p: new Vector2(2, -2), hIn: new Vector2(0, 0), hOut: new Vector2(0, 0), mode: "manual" },
            { p: new Vector2(0, 2), hIn: new Vector2(0, 0), hOut: new Vector2(0, 0), mode: "manual" },
          ],
        },
      ],
    },
  ],
});

describe("mask schema", () => {
  it("round-trips masks through serialize/parse and hydrates anchor points to Vector2", () => {
    const parsed = parseDoc(serializeDoc(baseDoc()));
    const mask = (parsed.layers[0] as ObjectInstance).masks![0]!;
    expect(mask.mode).toBe("keep");
    expect(mask.follow).toBe(true);
    expect(mask.anchors).toHaveLength(3);
    expect(mask.anchors[0]!.p).toBeInstanceOf(Vector2);
    expect(mask.anchors[0]!.p.x).toBe(-2);
  });

  it("a doc with no masks parses unchanged (masks omitted)", () => {
    const d = baseDoc();
    delete (d.layers[0] as ObjectInstance).masks;
    const parsed = parseDoc(serializeDoc(d));
    expect((parsed.layers[0] as ObjectInstance).masks).toBeUndefined();
  });
});
