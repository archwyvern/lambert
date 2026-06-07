import {
  AddRegular,
  ArrowMinimizeRegular,
  DismissRegular,
  SubtractRegular,
  WindowRegular,
} from "@fluentui/react-icons";
import { useRef } from "react";

export type Dock3D = "docked" | "float";

export interface FloatGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const HEADER_H = 26;
export const DOCKED_SIZE = 300;

const startCaptureDrag = (e: React.PointerEvent, onMove: (dx: number, dy: number) => void): void => {
  e.stopPropagation();
  e.preventDefault();
  const move = (ev: PointerEvent): void => onMove(ev.movementX, ev.movementY);
  const up = (): void => {
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", up, true);
  };
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
};

/**
 * 3D inspection panel: a docked mini view in the viewport corner, or a free-floating,
 * draggable + resizable panel still inside the app window. Same shared WebGPU canvas in
 * both modes — only its container chrome changes.
 */
export function Preview3DPanel(props: {
  canvasRef: React.Ref<HTMLCanvasElement>;
  canvasW: number;
  canvasH: number;
  mode: Dock3D;
  geom: FloatGeom;
  setGeom: (g: FloatGeom) => void;
  setMode: (m: Dock3D) => void;
  onClose: () => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  zoomBy: (factor: number) => void;
}): React.JSX.Element {
  const { canvasRef, canvasW, canvasH, mode, geom, setGeom, setMode, onClose, onCanvasDown, onWheel, zoomBy } = props;
  const geomRef = useRef(geom);
  geomRef.current = geom;

  const floating = mode === "float";
  const outer: React.CSSProperties = floating
    ? { position: "absolute", left: geom.x, top: geom.y, width: geom.w, height: geom.h }
    : { position: "absolute", right: 12, bottom: 32, width: DOCKED_SIZE, height: DOCKED_SIZE + HEADER_H };

  const iconBtn =
    "flex h-[18px] w-[18px] items-center justify-center text-fg-mid hover:text-fg";

  return (
    <div
      className="flex flex-col border border-border bg-surface2/95 shadow-[var(--shadow-popover)]"
      style={outer}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className={`flex h-[26px] shrink-0 items-center justify-between border-b border-border px-2 ${floating ? "cursor-move" : ""}`}
        onPointerDown={
          floating
            ? (e) =>
                startCaptureDrag(e, (dx, dy) =>
                  setGeom({ ...geomRef.current, x: geomRef.current.x + dx, y: geomRef.current.y + dy }),
                )
            : undefined
        }
      >
        <span className="text-sm font-semibold uppercase tracking-wide text-fg-mid">3D</span>
        <div className="flex items-center gap-0.5">
          <button title="Zoom out" className={iconBtn} onClick={() => zoomBy(1.25)} onPointerDown={(e) => e.stopPropagation()}>
            <SubtractRegular style={{ fontSize: 12 }} />
          </button>
          <button title="Zoom in" className={iconBtn} onClick={() => zoomBy(0.8)} onPointerDown={(e) => e.stopPropagation()}>
            <AddRegular style={{ fontSize: 12 }} />
          </button>
          <button
            title={floating ? "Dock" : "Pop out"}
            className={iconBtn}
            onClick={() => setMode(floating ? "docked" : "float")}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {floating ? <ArrowMinimizeRegular style={{ fontSize: 12 }} /> : <WindowRegular style={{ fontSize: 12 }} />}
          </button>
          <button title="Close" className={iconBtn} onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
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
        />
        {floating ? (
          <div
            title="Resize"
            className="absolute right-0 bottom-0 h-3.5 w-3.5 cursor-nwse-resize"
            style={{
              background:
                "linear-gradient(135deg, transparent 50%, var(--color-border-light) 50%, var(--color-border-light) 70%, transparent 70%)",
            }}
            onPointerDown={(e) =>
              startCaptureDrag(e, (dx, dy) =>
                setGeom({
                  ...geomRef.current,
                  w: Math.max(220, geomRef.current.w + dx),
                  h: Math.max(180, geomRef.current.h + dy),
                }),
              )
            }
          />
        ) : null}
      </div>
    </div>
  );
}
