import { AddRegular, SubtractRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import type { use3DCamera } from "./use3DCamera";

/**
 * The 3D inspection view. Always mounted (App swaps it between the big centre slot and the
 * small corner under the inspector via grid-area). Owns the 3D canvas DOM + its backing-store
 * size; the editor's PreviewRenderer (in CanvasView) renders into it via attach3D and reads
 * canvas.width/height directly each frame, so this component just sizes the canvas and wires
 * the orbit gestures.
 */
export function Preview3D(props: {
  cam: ReturnType<typeof use3DCamera>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  docW: number;
  docH: number;
  enabled: boolean;
  /** Called after the 3D canvas resizes so the renderer re-renders at the new resolution. */
  onResize: () => void;
}): React.JSX.Element {
  const { cam, canvasRef, docW, docH, enabled, onResize } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });

  // measure the container and size the canvas backing store; the renderer reads these
  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    const resize = (): void => {
      const r = host.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      setSize({ w, h });
      canvas.width = Math.max(1, Math.floor(w * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(h * devicePixelRatio));
      onResize();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focal = enabled ? cam.focal(docW, docH, size.w, size.h) : null;
  const inView = (p: { x: number; y: number } | null): p is { x: number; y: number } =>
    !!p && p.x >= 0 && p.x <= size.w && p.y >= 0 && p.y <= size.h;
  // focal-height aid, shown only while a focal-translation gesture is live: a dashed line straight
  // down from the focal to its point on the floor (the ringed end), so the focal's height reads clearly.
  const t = cam.orbit.target;
  const showAid = enabled && cam.translating;
  const proj = showAid ? cam.project(docW, docH, size.w, size.h) : null;
  const ground = proj ? proj([t.x, 0, t.z]) : null;
  const iconBtn = "flex h-[18px] w-[18px] items-center justify-center text-fg-mid hover:text-fg";

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        onPointerDown={cam.onCanvasDown(docW, docH, size.h)}
        onWheel={(e) => {
          e.stopPropagation();
          cam.onWheel(docW, docH)(e);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[22px] items-center justify-between px-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-fg-mid">3D</span>
        <div className="pointer-events-auto flex items-center gap-0.5">
          <button title="Zoom out" className={iconBtn} onClick={() => cam.zoomBy(1.25)}>
            <SubtractRegular style={{ fontSize: 12 }} />
          </button>
          <button title="Zoom in" className={iconBtn} onClick={() => cam.zoomBy(0.8)}>
            <AddRegular style={{ fontSize: 12 }} />
          </button>
        </div>
      </div>
      {inView(focal) || showAid ? (
        <svg
          className="pointer-events-none absolute top-0 left-0"
          width={size.w}
          height={size.h}
          style={{ overflow: "visible" }}
        >
          {showAid ? (
            <g style={{ filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.9))" }}>
              {/* dashed plumb line from the focal down to the floor */}
              {ground && focal ? (
                <line
                  x1={focal.x}
                  y1={focal.y}
                  x2={ground.x}
                  y2={ground.y}
                  stroke="var(--color-link)"
                  strokeWidth={1.25}
                  strokeDasharray="3 3"
                />
              ) : null}
              {/* floor end: a flat ring + filled dot so it reads as the ground contact point */}
              {ground ? (
                <g>
                  <ellipse
                    cx={ground.x}
                    cy={ground.y}
                    rx={6}
                    ry={2.5}
                    fill="none"
                    stroke="var(--color-link)"
                    strokeWidth={1.25}
                  />
                  <circle cx={ground.x} cy={ground.y} r={2} fill="var(--color-link)" />
                </g>
              ) : null}
            </g>
          ) : null}
          {inView(focal) ? (
            <g stroke="var(--color-accent)" strokeWidth={1.25} style={{ filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.9))" }}>
              <line x1={focal.x - 7} y1={focal.y} x2={focal.x + 7} y2={focal.y} />
              <line x1={focal.x} y1={focal.y - 7} x2={focal.x} y2={focal.y + 7} />
              <circle cx={focal.x} cy={focal.y} r={3} fill="none" />
            </g>
          ) : null}
        </svg>
      ) : null}
      {!enabled ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-fg-mid">3D preview</div>
      ) : null}
    </div>
  );
}
