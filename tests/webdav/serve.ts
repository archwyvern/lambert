import { startFixture } from "./fixtureServer";

/**
 * Standalone fixture runner for manual testing: `pnpm dav:serve <dir> [port]`.
 * Serves <dir>'s child directories as remote projects with sha256 etags (skyrat-like).
 * Credentials are dev/dev.
 */
const dir = process.argv[2];
if (!dir) {
  console.error("usage: pnpm dav:serve <root-dir> [port]");
  process.exit(1);
}
const port = Number(process.argv[3] ?? 41100);

const handle = await startFixture({ root: dir, username: "dev", password: "dev", etagMode: "sha256", port });
console.log(`WebDAV fixture serving ${dir}`);
console.log(`  URL:  ${handle.url}`);
console.log(`  Auth: dev / dev`);
