import { useRef } from "react";

/**
 * Vertical panel divider, ported from the Space2D editor's Sash: 1px visual line with a
 * 7px grab area overlapping the neighbors. Reports horizontal deltas; the parent owns
 * clamping and persistence.
 */
export function Sash(props: { onDrag: (dx: number) => void; onEnd?: () => void }): React.JSX.Element {
  const last = useRef(0);
  return (
    <div className="group relative w-[1px] shrink-0 bg-border">
      <div
        className="absolute inset-y-0 -left-[3px] z-20 w-[7px] cursor-col-resize"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          last.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (!(e.buttons & 1)) return;
          props.onDrag(e.clientX - last.current);
          last.current = e.clientX;
        }}
        onPointerUp={() => props.onEnd?.()}
      />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[1px] bg-border group-hover:bg-border-light" />
    </div>
  );
}
