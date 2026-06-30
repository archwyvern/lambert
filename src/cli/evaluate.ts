import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { decode } from "fast-png";
import { emptyProjectConfig, parseDoc, parseProjectConfig } from "../document/schema";
import { PROJECT_FILE } from "../document/workspace";
import { resolveDiffuse, type DiffuseHost } from "../document/diffuseSource";
import { flattenLayers } from "../field/flatten";
import { renderField } from "../field/render";
import { encodeHeightmapPng } from "../exporters/heightmap";
import { encodeNormalPng } from "../exporters/normalmap";
import { diffuseOpacity, encodeNxPng } from "../exporters/nx";
import "../field/objects";

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

// Headless diffuse resolver: file:// reads the local FS; http(s):// fetches + caches under a CLI-local
// dir (its own, not the app's userData — the CLI is a dev/CI tool; sharing isn't worth the platform glue).
const CLI_CACHE = path.join(os.homedir(), ".cache", "lambert", "diffuse-cache");
const cliHost: DiffuseHost = {
  readFile: (p) => Promise.resolve(new Uint8Array(readFileSync(p))),
  fetchUrl: async (url, opts) => {
    const cacheFile = path.join(CLI_CACHE, createHash("sha256").update(url).digest("hex"));
    if (!opts?.refresh && existsSync(cacheFile)) return new Uint8Array(readFileSync(cacheFile));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    mkdirSync(CLI_CACHE, { recursive: true });
    writeFileSync(cacheFile, bytes);
    return bytes;
  },
};

async function main(): Promise<void> {
  const [docPath, outDirArg] = process.argv.slice(2);
  if (!docPath) {
    console.error("usage: pnpm eval <file.lmb> [outDir]");
    process.exit(2);
  }

  const doc = parseDoc(readFileSync(docPath, "utf8"));
  const docDir = path.dirname(path.resolve(docPath));
  const source = decode(await resolveDiffuse(cliHost, doc.source.uri));
  if (source.width !== doc.source.width || source.height !== doc.source.height) {
    console.error(
      `source is ${source.width}x${source.height} but document expects ` +
        `${doc.source.width}x${doc.source.height} — the NX contract requires an exact match`,
    );
    process.exit(1);
  }

  const r = renderField(flattenLayers(doc.layers), doc.source.width, doc.source.height, { supersample: 2 });
  if (r.mask.every((m) => m === 0)) console.warn("warning: authored mask is empty — NX would change nothing");

  const normalDirs = resolveNormalDirs(docDir);
  const outDir = outDirArg ? path.resolve(outDirArg) : docDir;
  const stem = path.basename(docPath).replace(/\.lmb$/i, "");
  const nxPath = path.join(outDir, `${stem}.nx.png`);
  writeFileSync(nxPath, encodeNxPng(r.normals, r.mask, r.width, r.height, normalDirs, diffuseOpacity(source)));
  writeFileSync(path.join(outDir, `${stem}.height.png`), encodeHeightmapPng(r));
  writeFileSync(path.join(outDir, `${stem}.normal.png`), encodeNormalPng(r.normals, r.width, r.height, normalDirs));
  console.log(`wrote ${nxPath} (+ height/normal debug maps)`);
}

void main();
