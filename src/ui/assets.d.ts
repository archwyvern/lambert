declare module "*.png" {
  const url: string;
  export default url;
}

// @fontsource-variable/* ship CSS-injecting side-effect entrypoints with no type declarations.
declare module "@fontsource-variable/inter";
declare module "@fontsource-variable/jetbrains-mono";
