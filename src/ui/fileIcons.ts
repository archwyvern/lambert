import { registerFileIcons } from "@carapace/shell";

/**
 * Lambert's own formats on top of the bundled Seti set (which already covers the common
 * image/code types). Side-effect module — import once at startup. Same convention as
 * drydock: engine-own documents get the default page glyph in the brand violet.
 */
registerFileIcons({
  extensions: {
    ".lmb": { seti: "_default", color: "#a074c4" }, // lambert height-field document
  },
  fileNames: {
    // hidden from lambert's own explorer, but right wherever else it shows up
    "project.lambert": { seti: "_config" },
  },
});
