import {
  AddRegular,
  ArrowMaximizeRegular,
  ArrowMinimizeRegular,
  DismissRegular,
  SubtractRegular,
} from "@fluentui/react-icons";

export type Dock3D = "docked" | "full";

export const HEADER3D = 26;
export const DOCKED_SIZE = 300;

/**
 * 3D inspection view, sharing the editor's WebGPU canvas. "docked" = a fixed mini-view in
 * the corner; "full" = an overlay filling the whole editor area (Space shrinks it back).
 */
export function Preview3DPanel(props: {
  mode: Dock3D;
  canvasRef: React.Ref<HTMLCanvasElement>;
  canvasW: number;
  canvasH: number;
  onToggleSize: () => void;
  onClose: () => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  zoomBy: (factor: number) => void;
  focal: { x: number; y: number } | null;
}): React.JSX.Element {
  const { mode, canvasRef, canvasW, canvasH, onToggleSize, onClose, onCanvasDown, onWheel, zoomBy, focal } = props;
  const full = mode === "full";
  const iconBtn = "flex h-[18px] w-[18px] items-center justify-center text-fg-mid hover:text-fg";

  const outer: React.CSSProperties = full
    ? { position: "absolute", inset: 0 }
    : { position: "absolute", right: 12, bottom: 32, width: DOCKED_SIZE, height: DOCKED_SIZE + HEADER3D };

  return (
    <div
      className="flex flex-col border border-border bg-surface2/95 shadow-[var(--shadow-popover)]"
      style={outer}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex h-[26px] shrink-0 items-center justify-between border-b border-border px-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-fg-mid">
          3D{full ? <span className="ml-2 normal-case text-fg-mid opacity-70">— maximized</span> : null}
        </span>
        <div className="flex items-center gap-0.5">
          <button title="Zoom out" className={iconBtn} onClick={() => zoomBy(1.25)}>
            <SubtractRegular style={{ fontSize: 12 }} />
          </button>
          <button title="Zoom in" className={iconBtn} onClick={() => zoomBy(0.8)}>
            <AddRegular style={{ fontSize: 12 }} />
          </button>
          <button title={full ? "Shrink" : "Fill the editor"} className={iconBtn} onClick={onToggleSize}>
            {full ? <ArrowMinimizeRegular style={{ fontSize: 12 }} /> : <ArrowMaximizeRegular style={{ fontSize: 12 }} />}
          </button>
          <button title="Close" className={iconBtn} onClick={onClose}>
            <DismissRegular style={{ fontSize: 12 }} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          style={{ width: canvasW, height: canvasH, display: "block" }}
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={onCanvasDown}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {focal && focal.x >= 0 && focal.x <= canvasW && focal.y >= 0 && focal.y <= canvasH ? (
          <svg className="pointer-events-none absolute top-0 left-0" width={canvasW} height={canvasH} style={{ overflow: "visible" }}>
            <g stroke="var(--color-accent)" strokeWidth={1.25} style={{ filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.9))" }}>
              <line x1={focal.x - 7} y1={focal.y} x2={focal.x + 7} y2={focal.y} />
              <line x1={focal.x} y1={focal.y - 7} x2={focal.x} y2={focal.y + 7} />
              <circle cx={focal.x} cy={focal.y} r={3} fill="none" />
            </g>
          </svg>
        ) : null}
      </div>
    </div>
  );
}
