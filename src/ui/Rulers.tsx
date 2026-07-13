import { Vector2 } from "@aphralatrax/primitives";
import { v2 } from "../field/vec";
import { canvasToScreen, screenToCanvas, type Viewport } from "./viewport";

/** Ruler strip thickness in px. Shared with CanvasView's canvas-area inset. */
export const RULER = 22;

/** A "nice" tick step (1/2/5 × 10ⁿ doc px) so labels stay ~>=64 screen px apart at the given zoom. */
function niceStep(zoom: number): number {
  const target = 64 / zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1e-6))));
  for (const m of [1, 2, 5]) if (pow * m >= target) return pow * m;
  return pow * 10;
}

/**
 * Top + left rulers for the 2D canvas. Display-only (pointer-events-none in Phase 2): ticks + labels
 * mapping texture pixels to screen via the viewport, labelled relative to the origin. Rendered in
 * CanvasView's outer wrapper; the canvas area is inset by RULER so nothing hides under the strips.
 */
export function Rulers(props: {
  viewport: Viewport;
  origin: { x: number; y: number };
  areaW: number;
  areaH: number;
  /** Pointer-down on a strip pulls a new guide: top strip -> "h", left strip -> "v". */
  onGuideDragStart?: (orient: "v" | "h") => void;
}): React.JSX.Element {
  const { viewport, origin, areaW, areaH, onGuideDragStart } = props;
  const step = niceStep(viewport.zoom);
  const fmt = (n: number): string => (Math.abs(n) < 1e-6 ? "0" : `${Math.round(n)}`);

  // visible doc range across each strip (area-space screen 0..areaW maps to doc x0..x1)
  const x0 = screenToCanvas(viewport, v2(0, 0)).x;
  const x1 = screenToCanvas(viewport, v2(areaW, 0)).x;
  const y0 = screenToCanvas(viewport, v2(0, 0)).y;
  const y1 = screenToCanvas(viewport, v2(0, areaH)).y;

  // ticks are anchored to the ORIGIN (multiples of `step` measured from it), so 0 always lands on a
  // tick and labels read as round numbers relative to the origin. Stored as origin-relative values.
  const xticks: number[] = [];
  for (let r = Math.ceil((x0 - origin.x) / step) * step; r <= x1 - origin.x; r += step) xticks.push(r);
  const yticks: number[] = [];
  for (let r = Math.ceil((y0 - origin.y) / step) * step; r <= y1 - origin.y; r += step) yticks.push(r);

  const stripBg = "var(--color-surface2)";
  const tick = "var(--color-fg-mid)";

  return (
    <>
      {/* corner */}
      <div className="absolute" style={{ left: 0, top: 0, width: RULER, height: RULER, background: stripBg, borderRight: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }} />
      {/* top ruler */}
      <svg
        className="absolute"
        style={{ left: RULER, top: 0, width: `calc(100% - ${RULER}px)`, height: RULER, cursor: "row-resize" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return; // left only — guides are a left-drag gesture
          e.preventDefault();
          onGuideDragStart?.("h");
        }}
      >
        <rect x={0} y={0} width="100%" height={RULER} fill={stripBg} />
        <line x1={0} y1={RULER - 0.5} x2="100%" y2={RULER - 0.5} stroke="var(--color-border)" strokeWidth={1} />
        {xticks.map((r) => {
          const sx = canvasToScreen(viewport, v2(r + origin.x, 0)).x;
          return (
            <g key={`x${r}`}>
              <line x1={sx} y1={RULER - 6} x2={sx} y2={RULER} stroke={tick} strokeWidth={1} />
              <text x={sx + 3} y={11} fill={tick} fontSize={12} fontFamily="var(--font-sans, system-ui)">
                {fmt(r)}
              </text>
            </g>
          );
        })}
      </svg>
      {/* left ruler */}
      <svg
        className="absolute"
        style={{ left: 0, top: RULER, width: RULER, height: `calc(100% - ${RULER}px)`, cursor: "col-resize" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return; // left only — guides are a left-drag gesture
          e.preventDefault();
          onGuideDragStart?.("v");
        }}
      >
        <rect x={0} y={0} width={RULER} height="100%" fill={stripBg} />
        <line x1={RULER - 0.5} y1={0} x2={RULER - 0.5} y2="100%" stroke="var(--color-border)" strokeWidth={1} />
        {yticks.map((r) => {
          const sy = canvasToScreen(viewport, v2(0, r + origin.y)).y;
          return (
            <g key={`y${r}`}>
              <line x1={RULER - 6} y1={sy} x2={RULER} y2={sy} stroke={tick} strokeWidth={1} />
              <text x={11} y={sy - 3} fill={tick} fontSize={12} fontFamily="var(--font-sans, system-ui)" transform={`rotate(-90 11 ${sy - 3})`}>
                {fmt(r)}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
