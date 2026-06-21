import { describe, expect, it } from "vitest";
import { Vector3 } from "@carapace/primitives";
import { parseDoc, serializeDoc } from "../../src/document/schema";
import { isGroup } from "../../src/field/types";

const legacyJson = JSON.stringify({
  schemaVersion: 1,
  source: { path: "a.png", width: 8, height: 8 },
  shapes: [
    {
      id: "s1",
      typeId: "dome",
      transform: { pos: { x: 4, y: 4, z: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
      params: {},
      controlPoints: [],
      visible: true,
      locked: false,
    },
  ],
});

describe("layer tree schema", () => {
  it("migrates a legacy shapes[] doc to top-level shape layers", () => {
    const doc = parseDoc(legacyJson);
    expect(doc.layers).toHaveLength(1);
    expect(isGroup(doc.layers[0]!)).toBe(false);
    expect((doc.layers[0] as { id: string }).id).toBe("s1");
  });

  it("round-trips a group containing a shape", () => {
    const doc = parseDoc(legacyJson);
    const group = {
      kind: "group" as const,
      id: "g1",
      transform: { pos: new Vector3(2, 0, 0), rotation: 0.3, scale: new Vector3(2, 0.5, 1) },
      visible: true,
      locked: false,
      children: [doc.layers[0]!],
    };
    doc.layers = [group];
    const round = parseDoc(serializeDoc(doc));
    const g = round.layers[0]!;
    expect(isGroup(g)).toBe(true);
    if (isGroup(g)) {
      expect(g.transform.scale.x).toBe(2);
      expect(g.children).toHaveLength(1);
      expect(isGroup(g.children[0]!)).toBe(false);
    }
  });
});
