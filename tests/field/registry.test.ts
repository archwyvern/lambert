import { expect, test } from "vitest";
import { v2 } from "../../src/field/vec";
import {
  createObjectInstance,
  defineObjectType,
  dropUnknownLayers,
  getObjectType,
  hasObjectType,
  numParam,
} from "../../src/field/registry";
import type { LayerNode, ObjectType } from "../../src/field/types";

const testType: ObjectType = {
  id: "test-bump",
  name: "Test Bump",
  params: {
    height: { type: "px", default: 24, min: -256, max: 256 },
    kind: { type: "enum", options: ["a", "b"], default: "a" },
  },
  controlPoints: { kind: "none", default: [] },
  eval: () => ({ height: 0, sd: 1 }),
};

test("define + get round-trips, duplicate id throws", () => {
  defineObjectType(testType);
  expect(getObjectType("test-bump")).toBe(testType);
  expect(() => defineObjectType(testType)).toThrow(/duplicate/);
  expect(() => getObjectType("nope")).toThrow(/unknown object type/);
});

test("createObjectInstance seeds defaults from the schema", () => {
  const inst = createObjectInstance("test-bump", v2(10, 20));
  expect(inst.typeId).toBe("test-bump");
  expect(inst.transform.pos).toEqual({ x: 10, y: 20, z: 0 });
  expect(inst.params.height).toBe(24);
  expect(inst.params.kind).toBe("a");
  expect(inst.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
  expect(inst.visible).toBe(true);
  expect(numParam(inst, "height")).toBe(24);
  expect(() => numParam(inst, "kind")).toThrow(/not a number/);
});

test("dropUnknownLayers deletes unrecognized object types, keeps known, recurses groups", () => {
  defineObjectType({
    id: "drop-known",
    name: "Drop Known",
    params: {},
    controlPoints: { kind: "none", default: [] },
    eval: () => ({ height: 0, sd: 1 }),
  });
  expect(hasObjectType("drop-known")).toBe(true);
  expect(hasObjectType("cable")).toBe(false); // a legacy slug from before the GUID overhaul

  const known = createObjectInstance("drop-known", v2(0, 0));
  const legacy = { ...known, id: "legacy", typeId: "cable" };
  const group = {
    kind: "group",
    id: "g",
    name: "g",
    transform: known.transform,
    visible: true,
    locked: false,
    collapsed: false,
    children: [
      { ...known, id: "child-known" },
      { ...known, id: "child-legacy", typeId: "frustum" }, // unrecognized, nested
    ],
  } as unknown as LayerNode;

  const result = dropUnknownLayers([known, legacy, group]);
  expect(result.map((n) => n.id)).toEqual([known.id, "g"]); // legacy object dropped, group kept
  const keptGroup = result[1] as Extract<LayerNode, { kind: "group" }>;
  expect(keptGroup.children.map((c) => c.id)).toEqual(["child-known"]); // nested legacy dropped
});
