declare module "*.png" {
  const url: string;
  export default url;
}

// @fontsource-variable/* ship CSS-injecting side-effect entrypoints with no type declarations.
declare module "@fontsource-variable/inter";
declare module "@fontsource-variable/jetbrains-mono";

// Injected by Vite's `define` (electron.vite.config.ts) — the packaged app version.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILD_DATE__: string;
