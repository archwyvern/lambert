import { Vector2 } from "../math";
import { v2 } from "../field/vec";
import type { PointerDragHandlers } from "./usePointerDrag";

/** Shared SVG chrome for the transform gizmos (object + group): the drop-shadow halo, the rotate
 *  knobs at each edge midpoint, and the corner scale handles — previously copy-pasted between
 *  Gizmos and GroupGizmo. Plus the bezier anchor handles shared by the cable + mask editors. */

/** The drop-shadow halo filter so gizmo strokes read on any background. Pass a unique id per gizmo. */
export function GizmoHalo({ id }: { id: string }): React.JSX.Element {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#000000" floodOpacity="0.9" />
    </filter>
  );
}

const centroid = (corners: Vector2[]): Vector2 =>
  v2(corners.reduce((a, k) => a + k.x, 0) / corners.length, corners.reduce((a, k) => a + k.y, 0) / corners.length);

/** Rotate knobs: a short arm + grabbable knob extending outward from each edge midpoint. */
export function RotateKnobs(props: { corners: Vector2[]; handlers: () => PointerDragHandlers }): React.JSX.Element {
  const c0 = centroid(props.corners);
  return (
    <>
      {props.corners.map((c, i) => {
        const n = props.corners[(i + 1) % props.corners.length]!;
        const mid = v2((c.x + n.x) / 2, (c.y + n.y) / 2);
        let ox = mid.x - c0.x;
        let oy = mid.y - c0.y;
        const ol = Math.hypot(ox, oy) || 1;
        ox /= ol;
        oy /= ol;
        const knob = v2(mid.x + ox * 20, mid.y + oy * 20);
        return (
          <g key={`rot${i}`}>
            <line x1={mid.x} y1={mid.y} x2={knob.x} y2={knob.y} stroke="var(--color-accent)" strokeWidth={1} strokeOpacity={0.6} />
            <circle cx={knob.x} cy={knob.y} r={10} fill="transparent" className="pointer-events-auto cursor-rotate" {...props.handlers()} />
            <circle cx={knob.x} cy={knob.y} r={4} fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth={1.5} className="pointer-events-none" />
          </g>
        );
      })}
    </>
  );
}

/** Corner scale handles: a draggable square at each corner; the resize cursor follows the corner's
 *  diagonal off the box centre (screen space, so rotation is accounted for). */
export function CornerHandles(props: { corners: Vector2[]; handlers: (i: number) => PointerDragHandlers }): React.JSX.Element {
  const c0 = centroid(props.corners);
  return (
    <>
      {props.corners.map((c, i) => {
        const nwse = (c.x - c0.x) * (c.y - c0.y) > 0;
        return (
          <rect
            key={`sc${i}`}
            x={c.x - 5}
            y={c.y - 5}
            width={10}
            height={10}
            fill="var(--color-accent)"
            className={`pointer-events-auto ${nwse ? "cursor-nwse-resize" : "cursor-nesw-resize"}`}
            {...props.handlers(i)}
          />
        );
      })}
    </>
  );
}

/** A resolved bezier anchor: point + in/out tangents (already resolved from auto/manual). */
export interface ResolvedAnchor {
  p: Vector2;
  hIn: Vector2;
  hOut: Vector2;
}

/** Event handlers for an anchor point (selection + drag + context menu — caller-specific). */
export interface AnchorEventProps {
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * Bezier anchor handles shared by the cable editor (Gizmos) and the mask editor (MaskGizmo): per
 * anchor a tangent stalk + grabbable dot for each non-zero handle, and a draggable anchor point
 * (diamond when a corner, dot when smooth; white stroke when selected). The two editors differ only
 * in `toScreen`, the handler factory, the colour, and the anchor-point event wiring — all injected.
 */
export function AnchorHandles(props: {
  resolved: ResolvedAnchor[];
  toScreen: (p: Vector2) => Vector2;
  /** Fill for the anchor dots + tangent dots / stalks (accent for cables; per-mode for masks). */
  color: string;
  tangentProps: (kind: "in" | "out", i: number) => PointerDragHandlers;
  anchorProps: (i: number) => AnchorEventProps;
  isCorner: (i: number) => boolean;
  isSelected: (i: number) => boolean;
}): React.JSX.Element {
  return (
    <>
      {props.resolved.map((a, i) => {
        const pS = props.toScreen(a.p);
        const hasOut = a.hOut.x !== 0 || a.hOut.y !== 0;
        const hasIn = a.hIn.x !== 0 || a.hIn.y !== 0;
        const outS = props.toScreen(v2(a.p.x + a.hOut.x, a.p.y + a.hOut.y));
        const inS = props.toScreen(v2(a.p.x + a.hIn.x, a.p.y + a.hIn.y));
        const selStroke = props.isSelected(i) ? "#ffffff" : "var(--color-bg)";
        return (
          <g key={`anc-${i}`}>
            {hasOut ? <line x1={pS.x} y1={pS.y} x2={outS.x} y2={outS.y} stroke={props.color} strokeWidth={1} strokeOpacity={0.6} /> : null}
            {hasIn ? <line x1={pS.x} y1={pS.y} x2={inS.x} y2={inS.y} stroke={props.color} strokeWidth={1} strokeOpacity={0.6} /> : null}
            {hasOut ? (
              <g {...props.tangentProps("out", i)} style={{ cursor: "move" }}>
                <circle cx={outS.x} cy={outS.y} r={11} fill="transparent" style={{ pointerEvents: "auto" }} />
                <circle cx={outS.x} cy={outS.y} r={4} fill="var(--color-bg)" stroke={props.color} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
              </g>
            ) : null}
            {hasIn ? (
              <g {...props.tangentProps("in", i)} style={{ cursor: "move" }}>
                <circle cx={inS.x} cy={inS.y} r={11} fill="transparent" style={{ pointerEvents: "auto" }} />
                <circle cx={inS.x} cy={inS.y} r={4} fill="var(--color-bg)" stroke={props.color} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
              </g>
            ) : null}
            <g style={{ cursor: "move" }} {...props.anchorProps(i)}>
              <circle cx={pS.x} cy={pS.y} r={12} fill="transparent" style={{ pointerEvents: "auto" }} />
              {props.isCorner(i) ? (
                <rect
                  x={pS.x - 5}
                  y={pS.y - 5}
                  width={10}
                  height={10}
                  transform={`rotate(45 ${pS.x} ${pS.y})`}
                  fill={props.color}
                  stroke={selStroke}
                  strokeWidth={1.5}
                  style={{ pointerEvents: "none" }}
                />
              ) : (
                <circle cx={pS.x} cy={pS.y} r={5} fill={props.color} stroke={selStroke} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
              )}
            </g>
          </g>
        );
      })}
    </>
  );
}
