/** 2D light-direction pad: drag the dot; xy from pad position, z keeps the vector sane. */
export function LightPad(props: {
  lightDir: [number, number, number];
  onChange: (dir: [number, number, number]) => void;
}): React.JSX.Element {
  const { lightDir, onChange } = props;
  const R = 22;
  const cx = R + 2 + lightDir[0] * R;
  const cy = R + 2 + lightDir[1] * R;
  const fromEvent = (e: React.PointerEvent): void => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (e.clientX - rect.left - R - 2) / R));
    const y = Math.max(-1, Math.min(1, (e.clientY - rect.top - R - 2) / R));
    onChange([x, y, Math.max(0.3, Math.sqrt(Math.max(0, 1 - x * x - y * y)))]);
  };
  return (
    <svg
      width={R * 2 + 4}
      height={R * 2 + 4}
      className="cursor-crosshair"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) fromEvent(e);
      }}
    >
      <circle cx={R + 2} cy={R + 2} r={R} fill="#101013" stroke="var(--color-panel-edge)" />
      <circle cx={cx} cy={cy} r={4} fill="var(--color-accent)" />
    </svg>
  );
}
