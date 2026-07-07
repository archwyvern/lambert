import { describe, expect, it } from "vitest";
import {
  adjustmentKind,
  adjustmentParam,
  applyAdjustments,
  createAdjustment,
  detailChainParams,
} from "../../src/field/adjustments";
import { packObjects } from "../../src/field/gpu/pack";
import { resolveObjects } from "../../src/field/flatten";
import { v2 } from "../../src/field/vec";
import type { LayerNode, ObjectInstance } from "../../src/field/types";
import { createObjectInstance, ObjectTypeId } from "../../src/field/registry";
import "../../src/field/objects";

const region = {
  id: "r",
  typeId: ObjectTypeId.Adjust,
  controlPoints: [v2(-10, -10), v2(10, -10), v2(10, 10), v2(-10, 10)],
  params: {},
  visible: true,
} as unknown as ObjectInstance;

describe("adjustmentParam fallback chain", () => {
  const add = adjustmentKind("add")!;
  it("factory default when no project default and no instance value", () => {
    expect(adjustmentParam({ id: "a", kind: "add", strength: 1 }, add, undefined, "amount")).toBe(8);
  });
  it("project default beats factory", () => {
    expect(adjustmentParam({ id: "a", kind: "add", strength: 1 }, add, { add: { amount: 20 } }, "amount")).toBe(20);
  });
  it("instance override beats project default", () => {
    expect(adjustmentParam({ id: "a", kind: "add", strength: 1, params: { amount: 3 } }, add, { add: { amount: 20 } }, "amount")).toBe(3);
  });
});

describe("createAdjustment", () => {
  it("creates inheriting entries (no params)", () => {
    const a = createAdjustment("add");
    expect(a.params).toBeUndefined();
    expect(a.strength).toBe(1);
  });
});

describe("applyAdjustments with project defaults", () => {
  it("inheriting entry uses the project default", () => {
    const H = applyAdjustments(0, [{ id: "a", kind: "add", strength: 1 }], v2(0, 0), v2(0, 0), region, 1, {
      defaults: { add: { amount: 20 } },
    });
    expect(H).toBe(20);
  });
  it("overridden entry ignores the project default", () => {
    const H = applyAdjustments(0, [{ id: "a", kind: "add", strength: 1, params: { amount: 3 } }], v2(0, 0), v2(0, 0), region, 1, {
      defaults: { add: { amount: 20 } },
    });
    expect(H).toBe(3);
  });
});

describe("packer packs project defaults for inheriting entries", () => {
  it("packs the project value into the adjustment stream", () => {
    const obj = createObjectInstance(ObjectTypeId.Adjust, v2(0, 0));
    obj.adjustments = [{ id: "a", kind: "add", strength: 1 }];
    const withDefaults = packObjects(resolveObjects([obj]), { add: { amount: 20 } });
    const without = packObjects(resolveObjects([obj]));
    expect(Array.from(withDefaults.points)).toContain(20);
    expect(Array.from(withDefaults.points)).not.toContain(8);
    expect(Array.from(without.points)).toContain(8);
  });
});

describe("detailChainParams with project defaults", () => {
  const layer = { ...region, adjustments: [{ id: "d", kind: "detail", strength: 1 }] } as unknown as ObjectInstance;
  it("chain params come from project defaults when inheriting", () => {
    expect(detailChainParams([layer] as unknown as LayerNode[], { detail: { radius: 4 } })).toEqual({
      radius: 4,
      blur: 1,
      tolerance: 0.3,
    });
  });
});
