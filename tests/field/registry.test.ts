import { expect, test } from "vitest";
import { v2 } from "../../src/field/vec";
import {
  createObjectInstance,
  defineObjectType,
  getObjectType,
  numParam,
} from "../../src/field/registry";
import type { ObjectType } from "../../src/field/types";

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
