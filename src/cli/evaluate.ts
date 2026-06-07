import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decode } from "fast-png";
import { parseDoc } from "../document/schema";
import "../field/shapes";
import { renderField } from "../field/render";
import { encodeHeightmapPng } from "../exporters/heightmap";
import { encodeNormalPng } from "../exporters/normalmap";
import { encodeNxPng, nxFileName } from "../exporters/nx";

const [docPath, outDirArg] = process.argv.slice(2);
if (!docPath) {
  console.error("usage: pnpm eval <file.flatland> [outDir]");
  process.exit(2);
}

const doc = parseDoc(readFileSync(docPath, "utf8"));
const docDir = path.dirname(path.resolve(docPath));
const sourcePath = path.resolve(docDir, doc.source.path);
const source = decode(readFileSync(sourcePath));
if (source.width !== doc.source.width || source.height !== doc.source.height) {
  console.error(
    `source is ${source.width}x${source.height} but document expects ` +
      `${doc.source.width}x${doc.source.height} — the NX contract requires an exact match`,
  );
  process.exit(1);
}

const r = renderField(doc.shapes, doc.source.width, doc.source.height, { supersample: 2 });
if (r.mask.every((m) => m === 0)) console.warn("warning: authored mask is empty — NX would change nothing");

const outDir = outDirArg ? path.resolve(outDirArg) : docDir;
const stem = path.basename(sourcePath);
const nxPath = path.join(outDir, nxFileName(stem));
writeFileSync(nxPath, encodeNxPng(r.normals, r.mask, r.width, r.height, doc.normalDirs));
writeFileSync(path.join(outDir, `${stem}.height.png`), encodeHeightmapPng(r));
writeFileSync(
  path.join(outDir, `${stem}.normal.png`),
  encodeNormalPng(r.normals, r.width, r.height, doc.normalDirs),
);
console.log(`wrote ${nxPath} (+ height/normal debug maps)`);
