import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { renderField } from "../../src/field/render";
import { resolveObjects } from "../../src/field/flatten";
import { encodeNxPng } from "../../src/exporters/nx";
import { GATED_DIRS, gatedOpaque, GOLDEN_H, GOLDEN_W, goldenObjects } from "./fixture";

test("NX export matches the committed golden byte-for-byte", () => {
  const r = renderField(resolveObjects(goldenObjects()), GOLDEN_W, GOLDEN_H, { supersample: 2 });
  const actual = Buffer.from(encodeNxPng(r.normals, r.mask, r.width, r.height, { red: "right", green: "up" }));
  const goldenPath = path.join(import.meta.dirname, "sample.nx.golden.png");
  const golden = readFileSync(goldenPath);
  if (!actual.equals(golden)) {
    writeFileSync(goldenPath.replace(".golden.png", ".actual.png"), actual);
  }
  expect(actual.equals(golden)).toBe(true);
});

// The default golden runs fully-opaque + default dirs, so it byte-locks neither the alpha gate nor a
// flipped channel. This one does both (transparent left third + green: "down").
test("gated + flipped-green NX export matches its committed golden byte-for-byte", () => {
  const r = renderField(resolveObjects(goldenObjects()), GOLDEN_W, GOLDEN_H, { supersample: 2 });
  const actual = Buffer.from(encodeNxPng(r.normals, r.mask, r.width, r.height, GATED_DIRS, gatedOpaque()));
  const goldenPath = path.join(import.meta.dirname, "sample-gated.nx.golden.png");
  const golden = readFileSync(goldenPath);
  if (!actual.equals(golden)) {
    writeFileSync(goldenPath.replace(".golden.png", ".actual.png"), actual);
  }
  expect(actual.equals(golden)).toBe(true);
});
