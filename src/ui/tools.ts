/** Godot-style canvas tools: Q select, W move, E rotate, R scale. Select-mode drag
 *  overrides (godot parity): Alt = move, Ctrl = rotate, Ctrl+Alt = scale. */
export type ToolMode = "select" | "move" | "rotate" | "scale";

export const TOOL_KEYS: Record<string, ToolMode> = {
  q: "select",
  w: "move",
  e: "rotate",
  r: "scale",
};
