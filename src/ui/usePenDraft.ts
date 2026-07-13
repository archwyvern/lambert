import { useEffect, useState } from "react";
import type { Vector2 } from "@aphralatrax/primitives";
import type { Placing, ToolMode } from "./tools";

/** Screen px: clicking within this of the first pen point closes the loop. */
export const PEN_CLOSE_PX = 10;

/**
 * The two click-to-place drafts (QC-CARRY-1 extraction from CanvasView):
 * - `placing`: pen-extend mode — a new point follows the cursor, left-click drops it (chains);
 *   ends on Esc/Enter, or when the selection changes.
 * - `penPts`: the mask-pen draft loop (canvas/world points), committed into a Mask on close;
 *   abandoned on tool/selection/tab change or Esc/Enter.
 * CanvasView still owns the commit logic; this hook owns the draft state + its lifecycle.
 */
export function usePenDraft(opts: { tool: ToolMode; selectedId: string | null; tabId: string; cursorRef: React.RefObject<Vector2 | null> }): {
  placing: Placing | null;
  setPlacing: (p: Placing | null) => void;
  placeCursor: Vector2 | null;
  setPlaceCursor: React.Dispatch<React.SetStateAction<Vector2 | null>>;
  penPts: Vector2[];
  setPenPts: React.Dispatch<React.SetStateAction<Vector2[]>>;
} {
  const { tool, selectedId, tabId, cursorRef } = opts;
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [placeCursor, setPlaceCursor] = useState<Vector2 | null>(null);
  const [penPts, setPenPts] = useState<Vector2[]>([]);

  // leaving the object ends placing; Esc / Enter end it too
  useEffect(() => setPlacing(null), [selectedId]);
  // seed the pen ghost at the last cursor so it's visible immediately on entering placing mode
  useEffect(() => {
    if (placing) setPlaceCursor((pc) => pc ?? cursorRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing]);
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" || e.key === "Enter") setPlacing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  useEffect(() => setPenPts([]), [tool, selectedId, tabId]); // leaving pen abandons the draft
  useEffect(() => {
    if (tool !== "pen") return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" || e.key === "Enter") setPenPts([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  return { placing, setPlacing, placeCursor, setPlaceCursor, penPts, setPenPts };
}
