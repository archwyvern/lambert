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
  const fromEvent = (e: React.PointerEvent): void => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    let x = (e.clientX - rect.left - R - 2) / R;
    let y = (e.clientY - rect.top - R - 2) / R;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len; // clamp the handle to the circle, not the bounding square
      y /= len;
    }
    onChange([x, y, Math.max(0.3, Math.sqrt(Math.max(0, 1 - x * x - y * y)))]);
  };
  return (
    <svg
      width={R * 2 + 4}
      height={R * 2 + 4}
      className="cursor-crosshair"
      role="slider"
      aria-label="Light direction"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
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
