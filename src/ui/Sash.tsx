import { useRef } from "react";
import { cx } from "./kit";

/**
 * Panel divider, ported from the Space2D editor's Sash: a 1px visual line with a 7px grab area
 * overlapping the neighbors. Reports a delta along its drag axis; the parent owns clamping and
 * persistence. Vertical (default) reports horizontal deltas; horizontal reports vertical deltas.
 */
export function Sash(props: {
  onDrag: (delta: number) => void;
  onEnd?: () => void;
  orientation?: "vertical" | "horizontal";
}): React.JSX.Element {
  const last = useRef(0);
  const horizontal = props.orientation === "horizontal";
  return (
    <div className={cx("group relative shrink-0 bg-border", horizontal ? "h-[1px]" : "w-[1px]")}>
      <div
        className={cx(
          "absolute z-20",
          horizontal ? "inset-x-0 -top-[3px] h-[7px] cursor-row-resize" : "inset-y-0 -left-[3px] w-[7px] cursor-col-resize",
        )}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = horizontal ? e.clientY : e.clientX;
        }}
        onPointerMove={(e) => {
          if (!(e.buttons & 1)) return;
          const c = horizontal ? e.clientY : e.clientX;
          props.onDrag(c - last.current);
          last.current = c;
        }}
        onPointerUp={() => props.onEnd?.()}
      />
      <div
        className={cx(
          "pointer-events-none absolute bg-border group-hover:bg-border-light",
          horizontal ? "inset-x-0 top-0 h-[1px]" : "inset-y-0 left-0 w-[1px]",
        )}
      />
    </div>
  );
}
