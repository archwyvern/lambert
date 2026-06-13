import { useRef, useState } from "react";
import { DEFAULT_ORBIT, Orbit, orbitMvp, orbitTarget, panAxes, projectToScreen } from "../field/gpu/preview3d";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 30;
const PITCH_MIN = 0.08;
const PITCH_MAX = Math.PI / 2 - 0.01; // ~89.4deg: as near straight-down as the lookAt basis allows
//   (exactly PI/2 makes the view dir parallel to up -> degenerate basis)
type V3 = [number, number, number];

/**
 * Orbit camera state + gestures, shared by the docked mini-view and the full editor view.
 * Buttons:
 *   left = drag the focal horizontally across the ground plane (height preserved);
 *   left+right = pan the focal vertically (mouse forward = up, back = down);
 *   right OR middle = orbit (yaw/pitch); wheel = dolly the camera in/out.
 */
export function use3DCamera() {
  const [orbit, setOrbit] = useState<Orbit>({ ...DEFAULT_ORBIT });
  const [translating, setTranslating] = useState(false); // a focal-pan gesture is live (drives the origin aid)
  const orbitRef = useRef(orbit); // live orbit for axis math inside the gesture closure
  orbitRef.current = orbit;
  const activeCleanup = useRef<(() => void) | null>(null);

  // Drag the focal HORIZONTALLY (height preserved): screen-right + the camera's forward direction
  // flattened onto the ground, so panning slides it across its current plane without lifting it.
  const groundPan = (docW: number, docH: number, cssH: number, dx: number, dy: number): void => {
    const { right, fwd } = panAxes(orbitRef.current);
    let gfx = fwd[0];
    let gfz = fwd[2];
    const gl = Math.hypot(gfx, gfz) || 1; // forward projected onto the ground, normalized
    gfx /= gl;
    gfz /= gl;
    const span = Math.max(docW, docH);
    setOrbit((o) => {
      // world units per screen pixel at the focal depth (perspective fovY = PI/4, focal at
      // distance span*dist from the eye) — so the drag tracks the cursor and scales with zoom
      const f = (2 * span * o.dist * Math.tan(Math.PI / 8)) / cssH;
      const sx = dx * f;
      const sy = dy * f; // drag down -> focal moves away into the scene (inverted)
      return {
        ...o,
        target: { x: o.target.x + right[0] * sx + gfx * sy, y: o.target.y, z: o.target.z + right[2] * sx + gfz * sy },
      };
    });
  };

  // Pan the focal vertically (left+right drag): mouse forward (up) raises it, back lowers it.
  const verticalPan = (docW: number, docH: number, cssH: number, dy: number): void => {
    const span = Math.max(docW, docH);
    setOrbit((o) => {
      const f = (2 * span * o.dist * Math.tan(Math.PI / 8)) / cssH;
      return { ...o, target: { ...o.target, y: o.target.y - dy * f } };
    });
  };

  // document-level CAPTURE listeners for the gesture lifetime — see CanvasView's note: react
  // dispatch from #root + the panel's stopPropagation kills bubble-phase document listeners
  const onCanvasDown = (docW: number, docH: number, cssH: number) => (e: React.PointerEvent): void => {
    if (e.buttons === 0) return;
    e.stopPropagation();
    e.preventDefault();
    activeCleanup.current?.();
    const onMove = (ev: PointerEvent): void => {
      const b = ev.buttons; // 1 = left, 2 = right, 4 = middle
      const dx = ev.movementX;
      const dy = ev.movementY;
      if (b & 1 && b & 2) {
        setTranslating(true);
        verticalPan(docW, docH, cssH, dy); // left+right = raise/lower the focal
      } else if (b & 2 || b & 4) {
        setTranslating(false);
        setOrbit((o) => ({
          ...o,
          yaw: o.yaw - dx * 0.01,
          pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, o.pitch + dy * 0.01)),
        })); // right or middle = rotate
      } else if (b & 1) {
        setTranslating(true);
        groundPan(docW, docH, cssH, dx, dy); // left = drag the focal horizontally
      }
    };
    const cleanup = (): void => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      activeCleanup.current = null;
      setTranslating(false);
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

  // wheel = dolly the camera in/out (dist); the focal stays on the floor
  const onWheel = (_docW: number, _docH: number) => (e: React.WheelEvent): void => {
    zoomBy(e.deltaY < 0 ? 0.9 : 1.1);
  };

  const focal = (docW: number, docH: number, cssW: number, cssH: number): { x: number; y: number } | null =>
    projectToScreen(orbitMvp(orbit, docW, docH, cssW / Math.max(1, cssH)), orbitTarget(orbit), cssW, cssH);

  /** A projector for the current view: world point -> canvas px (null if behind the camera). */
  const project =
    (docW: number, docH: number, cssW: number, cssH: number) =>
    (p: V3): { x: number; y: number } | null =>
      projectToScreen(orbitMvp(orbit, docW, docH, cssW / Math.max(1, cssH)), p, cssW, cssH);

  return { orbit, setOrbit, onCanvasDown, zoomBy, onWheel, focal, project, translating };
}
