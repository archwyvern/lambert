import { AddRegular, ArrowResetRegular, ArrowSwapRegular, PowerRegular, SubtractRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { ShortcutGuide } from "@carapace/shell";
import { DEFAULT_ORBIT } from "../field/gpu/preview3d";
import { GUIDE_3D } from "./keymap";
import { LightPad } from "./LightPad";
import { ICON } from "./kit";
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
  /** Toggle the 3D preview on/off (off skips the displaced-grid pass entirely). */
  onToggle: () => void;
  /** Called after the 3D canvas resizes so the renderer re-renders at the new resolution. */
  onResize: () => void;
  /** Occupying the big slot — show the navigation guide (the small corner is too tight for it). */
  big: boolean;
  /** Swap this 3D view between the big slot and the small corner. */
  onSwap: () => void;
  /** Scene light direction (shared with the 2D lit view) + its setter, for the in-view light pad. */
  lightDir: [number, number, number];
  onLightChange: (dir: [number, number, number]) => void;
}): React.JSX.Element {
  const { cam, canvasRef, docW, docH, enabled, onToggle, onResize, big, onSwap, lightDir, onLightChange } = props;
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
  const iconBtn = "flex h-control-xs w-control-xs items-center justify-center text-fg-mid hover:text-fg";

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        onPointerDown={cam.onCanvasDown(docW, docH, size.h)}
        onWheel={(e) => {
          e.stopPropagation();
          cam.onWheel(docW, docH)(e);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!enabled ? (
        // solid cover: hides the stale last frame AND blocks orbit gestures; one click enables
        <button
          className="absolute inset-0 grid cursor-pointer place-items-center bg-[var(--color-viewport-bg)] text-sm text-fg-mid hover:text-fg"
          onClick={onToggle}
        >
          3D preview off — click to enable
        </button>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[22px] items-center px-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-fg-mid">3D</span>
      </div>
      <div className="pointer-events-none absolute top-2 right-3 flex items-start gap-2">
        <div className="pointer-events-auto flex items-center gap-0.5">
          <button aria-label={big ? "Swap to corner" : "Swap to big view"} title={big ? "Swap to corner (X)" : "Swap to big view (X)"} className={iconBtn} onClick={onSwap}>
            <ArrowSwapRegular style={{ fontSize: ICON.xs }} />
          </button>
          {enabled ? (
            <>
              <button aria-label="Reset view" title="Reset view" className={iconBtn} onClick={() => cam.setOrbit({ ...DEFAULT_ORBIT })}>
                <ArrowResetRegular style={{ fontSize: ICON.xs }} />
              </button>
              <button aria-label="Zoom out" title="Zoom out" className={iconBtn} onClick={() => cam.zoomBy(1.25)}>
                <SubtractRegular style={{ fontSize: ICON.xs }} />
              </button>
              <button aria-label="Zoom in" title="Zoom in" className={iconBtn} onClick={() => cam.zoomBy(0.8)}>
                <AddRegular style={{ fontSize: ICON.xs }} />
              </button>
              <button aria-label="Turn 3D preview off" title="Turn 3D preview off" className={iconBtn} onClick={onToggle}>
                <PowerRegular style={{ fontSize: ICON.xs }} />
              </button>
            </>
          ) : null}
        </div>
        {enabled && big ? (
          <div
            className="pointer-events-auto flex flex-col items-center gap-1 border border-border bg-surface2/90 p-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <LightPad lightDir={lightDir} onChange={onLightChange} radius={34} />
            <span className="text-sm uppercase tracking-wide text-fg-mid">light</span>
          </div>
        ) : null}
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
      {enabled && big ? <ShortcutGuide position="absolute" storageKey="lambert.guide3d.open" sections={GUIDE_3D} /> : null}
    </div>
  );
}
