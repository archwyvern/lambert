import { useRef, useState } from "react";
import { DEFAULT_ORBIT, Orbit, orbitMvp, orbitTarget, panAxes, projectToScreen } from "../field/gpu/preview3d";

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 8;
type V3 = [number, number, number];

/**
 * Orbit camera state + gestures, shared by the docked mini-view and the full editor view.
 * Buttons: right = rotate; left = pan in the view plane (left/right + up/down); left+right
 * = pan across the ground (left/right + forward/back along the camera); middle = nothing;
 * wheel = dolly.
 */
export function use3DCamera() {
  const [orbit, setOrbit] = useState<Orbit>({ ...DEFAULT_ORBIT });
  // cleanup of the in-flight gesture, so adding/removing a button cleanly upgrades it
  // (e.g. left-drag pan -> press right -> becomes a ground pan) rather than stacking two
  const activeUp = useRef<(() => void) | null>(null);

  // document-level CAPTURE listeners for the gesture lifetime — see CanvasView's note: react
  // dispatch from #root + the panel's stopPropagation kills bubble-phase document listeners
  const beginGesture = (e: React.PointerEvent, step: (dx: number, dy: number) => void): void => {
    e.stopPropagation();
    e.preventDefault();
    activeUp.current?.();
    const onMove = (ev: PointerEvent): void => step(ev.movementX, ev.movementY);
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      activeUp.current = null;
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    activeUp.current = onUp;
  };

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
    const b = e.buttons; // mask of buttons currently down: 1 = left, 2 = right, 4 = middle
    if (b & 1 && b & 2) {
      const { right, groundFwd } = panAxes(orbit); // left+right = ground pan (left/right + fwd/back)
      beginGesture(e, (dx, dy) => panTarget(docW, docH, cssW, right, groundFwd, dx, dy));
    } else if (b & 2) {
      beginGesture(e, (dx, dy) =>
        setOrbit((o) => ({
          ...o,
          yaw: o.yaw - dx * 0.01,
          pitch: Math.min(1.45, Math.max(0.08, o.pitch + dy * 0.01)),
        })),
      ); // right = rotate
    } else if (b & 1) {
      const { right, up } = panAxes(orbit); // left = screen pan (left/right + up/down)
      beginGesture(e, (dx, dy) => panTarget(docW, docH, cssW, right, up, dx, dy));
    }
    // middle (b & 4 only) = nothing
  };

  const zoomBy = (factor: number): void =>
    setOrbit((o) => ({ ...o, dist: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, o.dist * factor)) }));

  const onWheel = (e: React.WheelEvent): void => zoomBy(e.deltaY < 0 ? 0.9 : 1.1);

  const focal = (docW: number, docH: number, cssW: number, cssH: number): { x: number; y: number } | null =>
    projectToScreen(orbitMvp(orbit, docW, docH, cssW / Math.max(1, cssH)), orbitTarget(orbit), cssW, cssH);

  return { orbit, setOrbit, onCanvasDown, zoomBy, onWheel, focal };
}
