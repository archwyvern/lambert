import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @carapace/shell is a github-declared dependency, but in development the renderer
// bundler resolves it to the local checkout's SOURCE so edits to carapace are live
// with no rebuild. The pnpm `link:` override symlinks the package (tsc resolves its
// types via dist); this alias points Vite at src instead.
// chokidar 5 is pure-JS ESM, so we BUNDLE @carapace/shell (the FileExplorer's fs server + ipc
// bridge) and chokidar into the main/preload output — `out/` is then fully self-contained and the
// packaged app needs no runtime node_modules. carapace is a github/link dep with no single-package
// npm install, so bundling is what makes a distributable build possible. Everything else (electron,
// node builtins) stays external via externalizeDepsPlugin's defaults.
const BUNDLE = ["@carapace/shell", "chokidar", "electron-updater"];

// Baked into the renderer for the About dialog; reflects the version electron-builder packages
// (CI bumps package.json before the build, so this is the released version).
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: BUNDLE })] },
  preload: { plugins: [externalizeDepsPlugin({ exclude: BUNDLE })] },
  renderer: {
    plugins: [tailwindcss()],
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    resolve: {
      // carapace is aliased to its SOURCE, which imports react itself — force a SINGLE react instance
      // (else carapace's hooks hit a different react copy: "Invalid hook call / null useState").
      dedupe: ["react", "react-dom"],
      alias: {
        "@carapace/shell": resolve(import.meta.dirname, "../carapace/packages/shell/src/index.ts"),
        "@carapace/primitives": resolve(import.meta.dirname, "../carapace/packages/primitives/src/index.ts"),
      },
    },
  },
});
