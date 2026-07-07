import type { ToolMode } from "./tools";

import type { ShortcutSection } from "@carapace/shell";

/** Guide sections now use carapace's ShortcutGuide shape (QC-UI-14: the bespoke panel is gone). */
export type GuideSection = ShortcutSection;

/** What the editor is currently doing — drives which shortcut sections are shown. */
export interface GuideContext {
  tool: ToolMode;
  /** "none" = no object or an object with no editable points (e.g. dome). */
  objectKind: "none" | "cable" | "mesh" | "polygon" | "polyline" | "rings";
  placing: boolean;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The contextual 2D shortcut guide. Ordered so the most relevant section is first: in placing
 * ("pen") mode that takes over entirely; otherwise tools, then the active tool, then the verbs for
 * the selected object kind, then the always-on view/edit keys.
 */
export function guide2D(ctx: GuideContext): GuideSection[] {
  if (ctx.placing) {
    // focus mode — the pen is live; show only what ends/continues it
    return [
      {
        title: "Placing",
        items: [
          { keys: "Click", label: "Drop point (keeps going)" },
          { keys: "Esc / Enter", label: "Finish" },
          { keys: "Right-click", label: "Cancel" },
          { keys: "MMB drag", label: "Pan" },
        ],
      },
    ];
  }

  const out: GuideSection[] = [
    { title: "Tools", items: [{ keys: "V W R S A I", label: "Select · Move · Rotate · Scale · Vertex · Measure" }] },
  ];

  if (ctx.tool === "measure") {
    out.push({
      title: "Measure",
      items: [
        { keys: "Drag", label: "Measure between two points" },
        { keys: "Esc", label: "Clear the measurement" },
      ],
    });
  }

  if (ctx.tool === "select") {
    out.push({
      title: "Select",
      items: [
        { keys: "Click", label: "Pick / drag to move" },
        { keys: "Click curve", label: "Insert anchor" },
        { keys: "Alt-drag", label: "Duplicate" },
        { keys: "Drag box handles", label: "Scale (Shift uniform · Ctrl centre)" },
        { keys: "Drag rotate arm", label: "Rotate (Shift 15°)" },
      ],
    });
  } else if (ctx.tool === "move" || ctx.tool === "rotate" || ctx.tool === "scale") {
    out.push({
      title: cap(ctx.tool),
      items: [
        { keys: "Drag", label: `${cap(ctx.tool)} selection` },
        { keys: "Shift", label: ctx.tool === "rotate" ? "Snap 15°" : ctx.tool === "scale" ? "Uniform" : "Axis lock" },
      ],
    });
  }

  if (ctx.objectKind === "cable") {
    out.push({
      title: "Cable",
      items: [
        { keys: "Drag anchor", label: "Move (stays smooth)" },
        { keys: "Drag handle", label: "Tangent (mirrored)" },
        { keys: "Alt-drag handle", label: "Asymmetric tangent" },
        { keys: "Double-click", label: "Smooth ↔ corner" },
        { keys: "Click curve", label: "Insert anchor" },
        { keys: "Right-click end", label: "Extend, then click to draw" },
        { keys: "Right-click", label: "Anchor menu" },
        { keys: "⌫", label: "Delete anchor" },
      ],
    });
  } else if (
    ctx.objectKind === "polygon" ||
    ctx.objectKind === "polyline" ||
    ctx.objectKind === "rings" ||
    ctx.objectKind === "mesh"
  ) {
    const items: GuideSection["items"] = [
      { keys: "Click vertex", label: "Select" },
      { keys: "Shift-click", label: "Add to selection" },
      { keys: "Drag", label: "Box-select / move" },
      { keys: "Alt-click edge", label: "Insert vertex" },
      { keys: "Right-click", label: "Vertex / edge menu" },
      { keys: "⌫", label: "Delete selected" },
    ];
    if (ctx.objectKind === "mesh") items.push({ keys: "Right-click", label: "Connect · Merge · Z-align" });
    out.push({ title: "Vertices", items });
  }

  out.push({
    title: "View & Edit",
    items: [
      { keys: "Wheel", label: "Zoom" },
      { keys: "MMB / Space-drag", label: "Pan" },
      { keys: "X", label: "Swap 3D view" },
      { keys: "F", label: "Cycle view mode" },
      { keys: "Arrows", label: "Nudge (Shift ×10)" },
      { keys: "Ctrl+Z / Ctrl+Shift+Z", label: "Undo / Redo" },
      { keys: "Ctrl+J", label: "Duplicate" },
    ],
  });
  return out;
}

/** The 3D preview navigation guide (static — the orbit camera has no contextual modes). */
export const GUIDE_3D: GuideSection[] = [
  {
    title: "3D View",
    items: [
      { keys: "Right-drag", label: "Orbit" },
      { keys: "Left / MMB drag", label: "Pan" },
      { keys: "Left+Right drag", label: "Raise / lower" },
      { keys: "Wheel", label: "Zoom" },
      { keys: "X", label: "Swap with 2D" },
    ],
  },
];
