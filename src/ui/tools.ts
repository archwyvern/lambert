/** The canvas tools (Photoshop-style keys: V select, W move, R rotate, S scale, A vertex, P pen,
 *  I measure — defaults live in commands.ts). Select-mode drag overrides (godot parity):
 *  Alt = move, Ctrl = rotate, Ctrl+Alt = scale.
 *  Vertex tool: the object body never grabs drags, so any drag is a vertex marquee. */
export type ToolMode = "select" | "move" | "rotate" | "scale" | "vertex" | "pen" | "measure";

/** DEFAULT key -> tool (capture aid: useDemoBootstrap's `tool=` query letter; live bindings
 *  come from the command registry, not this table). */
export const TOOL_KEYS: Record<string, ToolMode> = {
  v: "select",
  w: "move",
  r: "rotate",
  s: "scale",
  a: "vertex",
  p: "pen",
  i: "measure",
};

/** Click-to-place ("pen") mode: a new point rubber-bands from an anchor and the next left-click
 *  drops it (chaining until Esc/Enter/right-click). Entered from a right-click in the gizmo. */
export type Placing =
  | { kind: "cable-end"; objectId: string; end: "start" | "end" } // extend a cable past an end anchor
  | { kind: "vertex"; objectId: string; afterIndex: number }; // insert into a polygon/polyline after a vertex
