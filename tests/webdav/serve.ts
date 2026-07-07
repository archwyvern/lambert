import { startFixture } from "./fixtureServer";

/**
 * Standalone fixture runner for manual testing: `pnpm dav:serve <dir> [port] [Header:key]`.
 * Serves <dir>'s child directories as remote projects with sha256 etags (skyrat-like).
 * Basic credentials are dev/dev; the optional third arg ALSO accepts that exact API-key header
 * (e.g. `X-Skyrat-Api-Key:sekrit`) so the header auth mode can be exercised end to end.
 */
const dir = process.argv[2];
if (!dir) {
  console.error("usage: pnpm dav:serve <root-dir> [port] [Header:key]");
  process.exit(1);
}
const port = Number(process.argv[3] ?? 41100);
const headerArg = process.argv[4];
const apiHeader = headerArg
  ? { name: headerArg.slice(0, headerArg.indexOf(":")), value: headerArg.slice(headerArg.indexOf(":") + 1) }
  : undefined;

const handle = await startFixture({ root: dir, username: "dev", password: "dev", apiHeader, etagMode: "sha256", port });
console.log(`WebDAV fixture serving ${dir}`);
console.log(`  URL:  ${handle.url}`);
console.log(`  Auth: dev / dev${apiHeader ? ` (or header ${apiHeader.name}: ${apiHeader.value})` : ""}`);
