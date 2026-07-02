import { writeFileSync } from "node:fs";
import path from "node:path";
import { renderField } from "../../src/field/render";
import { resolveObjects } from "../../src/field/flatten";
import { encodeNxPng } from "../../src/exporters/nx";
import { GATED_DIRS, gatedOpaque, GOLDEN_H, GOLDEN_W, goldenObjects } from "./fixture";

const r = renderField(resolveObjects(goldenObjects()), GOLDEN_W, GOLDEN_H, { supersample: 2 });
const out = path.join(import.meta.dirname, "sample.nx.golden.png");
writeFileSync(out, encodeNxPng(r.normals, r.mask, r.width, r.height, { red: "right", green: "up" }));
console.log(`wrote ${out}`);

// second golden: flipped green + alpha-gated (see fixture.ts) — locks the gate + a dir flip in bytes
const gated = path.join(import.meta.dirname, "sample-gated.nx.golden.png");
writeFileSync(gated, encodeNxPng(r.normals, r.mask, r.width, r.height, GATED_DIRS, gatedOpaque()));
console.log(`wrote ${gated}`);
