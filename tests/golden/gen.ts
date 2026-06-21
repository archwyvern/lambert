import { writeFileSync } from "node:fs";
import path from "node:path";
import { renderField } from "../../src/field/render";
import { resolveShapes } from "../../src/field/flatten";
import { encodeNxPng } from "../../src/exporters/nx";
import { GOLDEN_H, GOLDEN_W, goldenShapes } from "./fixture";

const r = renderField(resolveShapes(goldenShapes()), GOLDEN_W, GOLDEN_H, { supersample: 2 });
const out = path.join(import.meta.dirname, "sample.nx.golden.png");
writeFileSync(out, encodeNxPng(r.normals, r.mask, r.width, r.height, { red: "right", green: "up" }));
console.log(`wrote ${out}`);
