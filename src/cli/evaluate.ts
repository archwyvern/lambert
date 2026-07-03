import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { decode } from "fast-png";
import { effectiveNormalDirs, effectiveOutput, parseDoc } from "../document/schema";
import { nxExtension } from "../document/exports";
import { resolveProjectConfig } from "../document/normalDirs";
import { resolveDiffuse, type DiffuseHost } from "../document/diffuseSource";
import { flattenLayers } from "../field/flatten";
import { renderField } from "../field/render";
import { encodeHeightmapPng } from "../exporters/heightmap";
import { encodeNormalPng } from "../exporters/normalmap";
import { diffuseOpacity, encodeNx } from "../exporters/nx";
import "../field/objects";

// Headless diffuse resolver: file:// reads the local FS; http(s):// fetches + caches under a CLI-local
// dir (its own, not the app's userData — the CLI is a dev/CI tool; sharing isn't worth the platform glue).
const CLI_CACHE = path.join(os.homedir(), ".cache", "lambert", "diffuse-cache");
const cliHost: DiffuseHost = {
  readFile: (p) => Promise.resolve(new Uint8Array(readFileSync(p))),
  fetchUrl: async (url, opts) => {
    const cacheFile = path.join(CLI_CACHE, createHash("sha256").update(url).digest("hex"));
    if (!opts?.refresh && existsSync(cacheFile)) return new Uint8Array(readFileSync(cacheFile));
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) }); // don't hang CI on a dead host
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // reject a non-PNG body (error page / truncated) before caching it — else it's served forever
    const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
    if (!png) throw new Error(`fetched ${url} but it isn't a PNG image (wrong URL or an error page?)`);
    mkdirSync(CLI_CACHE, { recursive: true });
    writeFileSync(cacheFile, bytes);
    return bytes;
  },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // The height/normal PNGs are debug aids that DON'T match the shipped NX (8-bit half-range blue,
  // alpha=255 vs the NX's 16-bit gated alpha), so they're off by default to avoid clutter + confusion.
  const debug = args.includes("--debug");
  const [docPath, outDirArg] = args.filter((a) => !a.startsWith("--"));
  if (!docPath) {
    console.error("usage: pnpm eval <file.lmb> [outDir] [--debug]");
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

  const config = resolveProjectConfig(docDir);
  const normalDirs = effectiveNormalDirs(doc, config); // per-doc override wins
  const output = effectiveOutput(doc, config);
  const outDir = outDirArg ? path.resolve(outDirArg) : docDir;
  const stem = path.basename(docPath).replace(/\.lmb$/i, "");
  const nxPath = path.join(outDir, `${stem}${nxExtension(output)}`);
  writeFileSync(nxPath, encodeNx(r.normals, r.mask, r.width, r.height, normalDirs, diffuseOpacity(source), output));
  if (debug) {
    writeFileSync(path.join(outDir, `${stem}.height.png`), encodeHeightmapPng(r));
    writeFileSync(path.join(outDir, `${stem}.normal.png`), encodeNormalPng(r.normals, r.width, r.height, normalDirs));
    console.log(`wrote ${nxPath} (+ --debug height/normal maps; these are NOT the shipped NX)`);
  } else {
    console.log(`wrote ${nxPath}`);
  }
}

void main();
