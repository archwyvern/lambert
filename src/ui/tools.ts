/** Godot-style canvas tools: Q select, W move, E rotate, R scale, T vertex. Select-
 *  mode drag overrides (godot parity): Alt = move, Ctrl = rotate, Ctrl+Alt = scale.
 *  Vertex tool: the object body never grabs drags, so any drag is a vertex marquee. */
export type ToolMode = "select" | "move" | "rotate" | "scale" | "vertex" | "pen";

export const TOOL_KEYS: Record<string, ToolMode> = {
  q: "select",
  w: "move",
  e: "rotate",
  r: "scale",
  t: "vertex",
  p: "pen",
};

/** Click-to-place ("pen") mode: a new point rubber-bands from an anchor and the next left-click
 *  drops it (chaining until Esc/Enter/right-click). Entered from a right-click in the gizmo. */
export type Placing =
  | { kind: "cable-end"; objectId: string; end: "start" | "end" } // extend a cable past an end anchor
  | { kind: "vertex"; objectId: string; afterIndex: number }; // insert into a polygon/polyline after a vertex
