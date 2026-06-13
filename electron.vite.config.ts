import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

// @carapace/shell is a github-declared dependency, but in development the renderer
// bundler resolves it to the local checkout's SOURCE so edits to carapace are live
// with no rebuild. The pnpm `link:` override symlinks the package (tsc resolves its
// types via dist); this alias points Vite at src instead.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@carapace/shell": resolve(import.meta.dirname, "../carapace/packages/shell/src/index.ts"),
        "@carapace/primitives": resolve(import.meta.dirname, "../carapace/packages/primitives/src/index.ts"),
      },
    },
  },
});
