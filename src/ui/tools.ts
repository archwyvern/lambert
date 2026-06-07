/** Godot-style canvas tools: Q select, W move, E rotate, R scale, T vertex. Select-mode
 *  drag overrides (godot parity): Alt = move, Ctrl = rotate, Ctrl+Alt = scale.
 *  Vertex tool: the shape body never grabs drags, so any drag is a vertex marquee. */
export type ToolMode = "select" | "move" | "rotate" | "scale" | "vertex";

export const TOOL_KEYS: Record<string, ToolMode> = {
  q: "select",
  w: "move",
  e: "rotate",
  r: "scale",
  t: "vertex",
};
