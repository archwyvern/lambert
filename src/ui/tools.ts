/** Godot-style canvas tools: Q select, W move, E rotate, R scale, T vertex, P pen. Select-
 *  mode drag overrides (godot parity): Alt = move, Ctrl = rotate, Ctrl+Alt = scale.
 *  Vertex tool: the shape body never grabs drags, so any drag is a vertex marquee.
 *  Pen tool: click drops surface vertices; click the first one to close the loop. */
export type ToolMode = "select" | "move" | "rotate" | "scale" | "vertex" | "pen";

export const TOOL_KEYS: Record<string, ToolMode> = {
  q: "select",
  w: "move",
  e: "rotate",
  r: "scale",
  t: "vertex",
  p: "pen",
};
