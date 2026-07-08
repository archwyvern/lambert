import { registerFileIcons } from "@carapace/shell";

/**
 * Lambert's own formats on top of the bundled Seti set (which already covers the common
 * image/code types). Side-effect module — import once at startup. Same convention as
 * drydock: engine-own documents get the default page glyph in the brand violet.
 */
registerFileIcons({
  // .lmb is NOT registered here — the explorer renders the LambertMark itself for those rows
  // (see the FileExplorer getIcon in App); Seti only backs everything else.
  fileNames: {
    // hidden from lambert's own explorer, but right wherever else it shows up
    "project.lambert": { seti: "_config" },
  },
});
