import type { ToolMode } from "./tools";

/** One line in the on-screen shortcut guide: a key/gesture chip + what it does. */
export interface GuideRow {
  keys: string;
  desc: string;
}
export interface GuideSection {
  title: string;
  rows: GuideRow[];
}

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
        rows: [
          { keys: "Click", desc: "Drop point (keeps going)" },
          { keys: "Esc / Enter", desc: "Finish" },
          { keys: "Right-click", desc: "Cancel" },
          { keys: "MMB drag", desc: "Pan" },
        ],
      },
    ];
  }

  const out: GuideSection[] = [
    { title: "Tools", rows: [{ keys: "Q W E R T", desc: "Select · Move · Rotate · Scale · Vertex" }] },
  ];

  if (ctx.tool === "select") {
    out.push({
      title: "Select",
      rows: [
        { keys: "Click", desc: "Pick / drag to move" },
        { keys: "Alt-drag", desc: "Duplicate" },
        { keys: "Drag box handles", desc: "Scale (Shift uniform · Ctrl centre)" },
        { keys: "Drag rotate arm", desc: "Rotate (Shift 15°)" },
      ],
    });
  } else if (ctx.tool === "move" || ctx.tool === "rotate" || ctx.tool === "scale") {
    out.push({
      title: cap(ctx.tool),
      rows: [
        { keys: "Drag", desc: `${cap(ctx.tool)} selection` },
        { keys: "Shift", desc: ctx.tool === "rotate" ? "Snap 15°" : ctx.tool === "scale" ? "Uniform" : "Axis lock" },
      ],
    });
  }

  if (ctx.objectKind === "cable") {
    out.push({
      title: "Cable",
      rows: [
        { keys: "Drag anchor", desc: "Move (stays smooth)" },
        { keys: "Drag handle", desc: "Tangent (mirrored)" },
        { keys: "Alt-drag handle", desc: "Asymmetric tangent" },
        { keys: "Double-click", desc: "Smooth ↔ corner" },
        { keys: "Click curve", desc: "Insert anchor" },
        { keys: "Right-click end", desc: "Extend, then click to draw" },
        { keys: "Right-click", desc: "Anchor menu" },
        { keys: "⌫", desc: "Delete anchor" },
      ],
    });
  } else if (
    ctx.objectKind === "polygon" ||
    ctx.objectKind === "polyline" ||
    ctx.objectKind === "rings" ||
    ctx.objectKind === "mesh"
  ) {
    const rows: GuideRow[] = [
      { keys: "Click vertex", desc: "Select" },
      { keys: "Shift-click", desc: "Add to selection" },
      { keys: "Drag", desc: "Box-select / move" },
      { keys: "Alt-click edge", desc: "Insert vertex" },
      { keys: "Right-click", desc: "Vertex / edge menu" },
      { keys: "⌫", desc: "Delete selected" },
    ];
    if (ctx.objectKind === "mesh") rows.push({ keys: "Right-click", desc: "Connect · Merge · Z-align" });
    out.push({ title: "Vertices", rows });
  }

  out.push({
    title: "View & Edit",
    rows: [
      { keys: "Wheel", desc: "Zoom" },
      { keys: "MMB drag", desc: "Pan" },
      { keys: "Space", desc: "Swap 3D view" },
      { keys: "V", desc: "Cycle view mode" },
      { keys: "Arrows", desc: "Nudge (Shift ×10)" },
      { keys: "Ctrl+Z / Y", desc: "Undo / Redo" },
      { keys: "Ctrl+D", desc: "Duplicate" },
    ],
  });
  return out;
}

/** The 3D preview navigation guide (static — the orbit camera has no contextual modes). */
export const GUIDE_3D: GuideSection[] = [
  {
    title: "3D View",
    rows: [
      { keys: "Right-drag", desc: "Orbit" },
      { keys: "Left / MMB drag", desc: "Pan" },
      { keys: "Left+Right drag", desc: "Raise / lower" },
      { keys: "Wheel", desc: "Zoom" },
      { keys: "Space", desc: "Swap with 2D" },
    ],
  },
];
