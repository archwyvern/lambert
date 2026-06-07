import { AddRegular, DismissRegular, SubtractRegular, WindowRegular } from "@fluentui/react-icons";

export type Dock3D = "docked" | "window";

export const HEADER_H = 26;
export const DOCKED_SIZE = 300;

/**
 * Docked 3D inspection mini-view, pinned to the viewport corner. "Pop out" hands off to a
 * real second OS window (see View3DWindow); this panel only ever renders the docked state.
 */
export function Preview3DPanel(props: {
  canvasRef: React.Ref<HTMLCanvasElement>;
  canvasW: number;
  canvasH: number;
  onPopOut: () => void;
  onClose: () => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  zoomBy: (factor: number) => void;
  focal: { x: number; y: number } | null;
}): React.JSX.Element {
  const { canvasRef, canvasW, canvasH, onPopOut, onClose, onCanvasDown, onWheel, zoomBy, focal } = props;
  const iconBtn = "flex h-[18px] w-[18px] items-center justify-center text-fg-mid hover:text-fg";

  return (
    <div
      className="absolute right-3 bottom-8 flex flex-col border border-border bg-surface2/95 shadow-[var(--shadow-popover)]"
      style={{ width: DOCKED_SIZE, height: DOCKED_SIZE + HEADER_H }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex h-[26px] shrink-0 items-center justify-between border-b border-border px-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-fg-mid">3D</span>
        <div className="flex items-center gap-0.5">
          <button title="Zoom out" className={iconBtn} onClick={() => zoomBy(1.25)}>
            <SubtractRegular style={{ fontSize: 12 }} />
          </button>
          <button title="Zoom in" className={iconBtn} onClick={() => zoomBy(0.8)}>
            <AddRegular style={{ fontSize: 12 }} />
          </button>
          <button title="Pop out to a window" className={iconBtn} onClick={onPopOut}>
            <WindowRegular style={{ fontSize: 12 }} />
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
