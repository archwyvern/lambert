import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { renderField } from "../../src/field/render";
import { resolveShapes } from "../../src/field/flatten";
import { encodeNxPng } from "../../src/exporters/nx";
import { GOLDEN_H, GOLDEN_W, goldenShapes } from "./fixture";

test("NX export matches the committed golden byte-for-byte", () => {
  const r = renderField(resolveShapes(goldenShapes()), GOLDEN_W, GOLDEN_H, { supersample: 2 });
  const actual = Buffer.from(encodeNxPng(r.normals, r.mask, r.width, r.height, { red: "right", green: "up" }));
  const goldenPath = path.join(import.meta.dirname, "sample.nx.golden.png");
  const golden = readFileSync(goldenPath);
  if (!actual.equals(golden)) {
    writeFileSync(goldenPath.replace(".golden.png", ".actual.png"), actual);
  }
  expect(actual.equals(golden)).toBe(true);
});
