import { useRef, useState } from "react";
import { DEFAULT_ORBIT, Orbit, orbitMvp, orbitTarget, panAxes, projectToScreen } from "../field/gpu/preview3d";

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 8;
type V3 = [number, number, number];

/**
 * Orbit camera state + gestures, shared by the docked mini-view and the full editor view.
 * Buttons (decided live each move, so adding/dropping a button switches mode mid-drag):
 *   right OR middle = rotate; left = pan in the view plane (left/right + up/down);
 *   left+right = pan across the ground — forward/back along the camera + sideways.
 *   wheel = dolly.
 */
export function use3DCamera() {
  const [orbit, setOrbit] = useState<Orbit>({ ...DEFAULT_ORBIT });
  const orbitRef = useRef(orbit); // live orbit for axis math inside the gesture closure
  orbitRef.current = orbit;
  const activeCleanup = useRef<(() => void) | null>(null);

  const panBy = (docW: number, docH: number, cssW: number, ax: V3, ay: V3, dx: number, dy: number): void => {
    const span = Math.max(docW, docH);
    setOrbit((o) => {
      const f = (o.dist * span) / cssW;
      const sx = dx * f;
      const sy = -dy * f; // drag up (negative dy) -> move "into" the scene
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

  // document-level CAPTURE listeners for the gesture lifetime — see CanvasView's note: react
  // dispatch from #root + the panel's stopPropagation kills bubble-phase document listeners
  const onCanvasDown = (docW: number, docH: number, cssW: number) => (e: React.PointerEvent): void => {
    if (e.buttons === 0) return;
    e.stopPropagation();
    e.preventDefault();
    activeCleanup.current?.();
    const onMove = (ev: PointerEvent): void => {
      const b = ev.buttons; // 1 = left, 2 = right, 4 = middle
      const dx = ev.movementX;
      const dy = ev.movementY;
      if (b & 1 && b & 2) {
        const { right, fwd } = panAxes(orbitRef.current); // dolly pan: sideways + along view dir
        panBy(docW, docH, cssW, right, fwd, dx, dy);
      } else if (b & 2 || b & 4) {
        setOrbit((o) => ({
          ...o,
          yaw: o.yaw - dx * 0.01,
          pitch: Math.min(1.45, Math.max(0.08, o.pitch + dy * 0.01)),
        })); // right or middle = rotate
      } else if (b & 1) {
        const { right, up } = panAxes(orbitRef.current); // screen pan: sideways + up/down
        panBy(docW, docH, cssW, right, up, dx, dy);
      }
    };
    const cleanup = (): void => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      activeCleanup.current = null;
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.buttons === 0) cleanup(); // end only once every button is released
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    activeCleanup.current = cleanup;
  };

  const zoomBy = (factor: number): void =>
    setOrbit((o) => ({ ...o, dist: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, o.dist * factor)) }));

  const onWheel = (e: React.WheelEvent): void => zoomBy(e.deltaY < 0 ? 0.9 : 1.1);

  const focal = (docW: number, docH: number, cssW: number, cssH: number): { x: number; y: number } | null =>
    projectToScreen(orbitMvp(orbit, docW, docH, cssW / Math.max(1, cssH)), orbitTarget(orbit), cssW, cssH);

  return { orbit, setOrbit, onCanvasDown, zoomBy, onWheel, focal };
}
