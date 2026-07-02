/** 2D light-direction pad: drag the dot; xy from pad position, z keeps the vector sane. */
export function LightPad(props: {
  lightDir: [number, number, number];
  onChange: (dir: [number, number, number]) => void;
  radius?: number;
}): React.JSX.Element {
  const { lightDir, onChange, radius = 14 } = props;
  const R = radius;
  const cx = R + 2 + lightDir[0] * R;
  const cy = R + 2 + lightDir[1] * R;
  // set the light direction from a clamped-to-unit-circle (x,y); z keeps the vector on the hemisphere.
  // The pad is the orthographic projection of that hemisphere, so z = sqrt(1 - x^2 - y^2) (rim =
  // horizontal). The 0.3 floor keeps a fully horizontal light from going pure black on flat surfaces.
  const setXY = (x: number, y: number): void => {
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len; // clamp the handle to the circle, not the bounding square
      y /= len;
    }
    onChange([x, y, Math.max(0.3, Math.sqrt(Math.max(0, 1 - x * x - y * y)))]);
  };
  const fromEvent = (e: React.PointerEvent): void => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    setXY((e.clientX - rect.left - R - 2) / R, (e.clientY - rect.top - R - 2) / R);
  };
  return (
    <svg
      width={R * 2 + 4}
      height={R * 2 + 4}
      className="cursor-crosshair rounded-full outline-none focus-visible:ring-1 focus-visible:ring-accent"
      // a 2D directional pad, not a 1D slider — role=application + arrow-key nudging makes it keyboard-
      // operable (it was focus-less and mouse-only), without promising the slider's aria-valuenow contract.
      role="application"
      aria-label="Light direction — arrow keys to adjust"
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.2 : 0.05;
        if (e.key === "ArrowLeft") setXY(lightDir[0] - step, lightDir[1]);
        else if (e.key === "ArrowRight") setXY(lightDir[0] + step, lightDir[1]);
        else if (e.key === "ArrowUp") setXY(lightDir[0], lightDir[1] - step);
        else if (e.key === "ArrowDown") setXY(lightDir[0], lightDir[1] + step);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        // capture on the svg itself (not e.target, a child circle) so the drag keeps receiving moves
        // — and the handle keeps following, clamped to the rim — even when the cursor leaves the pad
        e.currentTarget.setPointerCapture(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) fromEvent(e);
      }}
    >
      <circle cx={R + 2} cy={R + 2} r={R} fill="var(--color-surface2)" stroke="var(--color-border-light)" />
      <circle cx={R + 2} cy={R + 2} r={2} fill="var(--color-border-light)" />
      <circle cx={cx} cy={cy} r={Math.max(4, R / 6)} fill="var(--color-accent)" />
    </svg>
  );
}
