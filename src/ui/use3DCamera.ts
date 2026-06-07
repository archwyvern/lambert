import { useState } from "react";
import { DEFAULT_ORBIT, Orbit, orbitMvp, orbitTarget, panAxes, projectToScreen } from "../field/gpu/preview3d";

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 8;
type V3 = [number, number, number];

// document-level CAPTURE listeners for the gesture lifetime — see CanvasView's note: react
// dispatch from #root + the panel's stopPropagation kills bubble-phase document listeners
const beginGesture = (e: React.PointerEvent, step: (dx: number, dy: number) => void): void => {
  e.stopPropagation();
  e.preventDefault();
  const onMove = (ev: PointerEvent): void => step(ev.movementX, ev.movementY);
  const onUp = (): void => {
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
  };
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onUp, true);
};

/**
 * Orbit camera state + gestures, shared by the docked mini-view and the pop-out window.
 * left = orbit; middle/shift+left = pan in the view plane; right (or L+R chord) = pan the
 * focal point across the ground (up/down = forward/back, sideways = sideways); wheel = dolly.
 */
export function use3DCamera() {
  const [orbit, setOrbit] = useState<Orbit>({ ...DEFAULT_ORBIT });

  const panTarget = (docW: number, docH: number, cssW: number, ax: V3, ay: V3, dx: number, dy: number): void => {
    const span = Math.max(docW, docH);
    setOrbit((o) => {
      const f = (o.dist * span) / cssW;
      const sx = dx * f;
      const sy = -dy * f; // drag up = move "into" the scene / upward
      return {
        ...o,
        target: {
          x: o.target.x + ax[0] * sx + ay[0] * sy,
          y: o.target.y + ax[1] * sx + ay[1] * sy,
          z: o.target.z + ax[2] * sx + ay[2] * sy,
        },
      };
    });
  };

  const onCanvasDown = (docW: number, docH: number, cssW: number) => (e: React.PointerEvent): void => {
    const ground = e.button === 2 || e.buttons === 3;
    const screen = e.button === 1 || (e.button === 0 && e.shiftKey);
    if (ground) {
      const { right, groundFwd } = panAxes(orbit);
      beginGesture(e, (dx, dy) => panTarget(docW, docH, cssW, right, groundFwd, dx, dy));
    } else if (screen) {
      const { right, up } = panAxes(orbit);
      beginGesture(e, (dx, dy) => panTarget(docW, docH, cssW, right, up, dx, dy));
    } else if (e.button === 0) {
      beginGesture(e, (dx, dy) =>
        setOrbit((o) => ({
          ...o,
          yaw: o.yaw - dx * 0.01,
          pitch: Math.min(1.45, Math.max(0.08, o.pitch + dy * 0.01)),
        })),
      );
    }
  };

  const zoomBy = (factor: number): void =>
    setOrbit((o) => ({ ...o, dist: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, o.dist * factor)) }));

  const onWheel = (e: React.WheelEvent): void => zoomBy(e.deltaY < 0 ? 0.9 : 1.1);

  const focal = (docW: number, docH: number, cssW: number, cssH: number): { x: number; y: number } | null =>
    projectToScreen(orbitMvp(orbit, docW, docH, cssW / Math.max(1, cssH)), orbitTarget(orbit), cssW, cssH);

  return { orbit, setOrbit, onCanvasDown, zoomBy, onWheel, focal };
}
