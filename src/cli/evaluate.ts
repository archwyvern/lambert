import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decode } from "fast-png";
import { emptyProjectConfig, parseDoc, parseProjectConfig } from "../document/schema";
import { PROJECT_FILE } from "../document/workspace";
import "../field/shapes";

/** Walk up from a doc's directory to find the project's normal-channel convention. */
function resolveNormalDirs(docDir: string): ReturnType<typeof emptyProjectConfig>["normalDirs"] {
  let dir = docDir;
  for (;;) {
    const candidate = path.join(dir, PROJECT_FILE);
    if (existsSync(candidate)) return parseProjectConfig(readFileSync(candidate, "utf8")).normalDirs;
    const parent = path.dirname(dir);
    if (parent === dir) return emptyProjectConfig().normalDirs;
    dir = parent;
  }
}
import { renderField } from "../field/render";
import { encodeHeightmapPng } from "../exporters/heightmap";
import { encodeNormalPng } from "../exporters/normalmap";
import { diffuseOpacity, encodeNxPng, nxFileName } from "../exporters/nx";

const [docPath, outDirArg] = process.argv.slice(2);
if (!docPath) {
  console.error("usage: pnpm eval <file.lambert> [outDir]");
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

const normalDirs = resolveNormalDirs(docDir);
const outDir = outDirArg ? path.resolve(outDirArg) : docDir;
const stem = path.basename(sourcePath);
const nxPath = path.join(outDir, nxFileName(stem));
writeFileSync(nxPath, encodeNxPng(r.normals, r.mask, r.width, r.height, normalDirs, diffuseOpacity(source)));
writeFileSync(path.join(outDir, `${stem}.height.png`), encodeHeightmapPng(r));
writeFileSync(
  path.join(outDir, `${stem}.normal.png`),
  encodeNormalPng(r.normals, r.width, r.height, normalDirs),
);
console.log(`wrote ${nxPath} (+ height/normal debug maps)`);
