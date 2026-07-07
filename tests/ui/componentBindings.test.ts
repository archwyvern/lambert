import { expect, test } from "vitest";
import { allComponentBindings, effectiveComponentKeys } from "@carapace/shell";

// the Shortcuts screen lists these rows — if registration breaks, the rows silently vanish
test("carapace tree verbs are registered with their factory defaults", () => {
  const byId = new Map(allComponentBindings().map((b) => [b.id, b]));
  expect(byId.get("tree.rename")).toMatchObject({ keys: "F2", when: "tree focus" });
  expect(byId.get("tree.delete")).toMatchObject({ keys: "Delete", when: "tree focus" });
});

test("lambert's override store rebinds a component verb", () => {
  expect(effectiveComponentKeys("tree.rename", { overrides: { "tree.rename": "Ctrl+F2" } })).toBe("Ctrl+F2");
  expect(effectiveComponentKeys("tree.rename", { overrides: {} })).toBe("F2");
});
