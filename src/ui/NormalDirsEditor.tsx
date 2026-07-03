import { useEffect, useRef } from "react";
import { normalSigns, type NormalDirs } from "../document/schema";
import { cx } from "./kit";

/**
 * Paint a normal-mapped hemisphere into `canvas` under the given channel convention — the classic
 * "which way does green point" reference ball. Image-space (y-down) normals, half-range blue, rim
 * anti-aliased to transparent. Shared by the settings editor and the canvas tint widget.
 */
export function drawNormalSphere(canvas: HTMLCanvasElement, dirs: NormalDirs): void {
  const size = canvas.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const s = normalSigns(dirs);
  const img = ctx.createImageData(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - r) / r;
      const dy = (y + 0.5 - r) / r;
      const d = Math.hypot(dx, dy);
      const i = (y * size + x) * 4;
      if (d >= 1) continue; // outside: transparent
      const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      img.data[i] = Math.round((0.5 + (s.red * dx) / 2) * 255);
      img.data[i + 1] = Math.round((0.5 + (s.green * dy) / 2) * 255);
      img.data[i + 2] = Math.round((0.5 + nz / 2) * 255);
      img.data[i + 3] = Math.round(Math.min(1, (1 - d) * r) * 255); // ~1px coverage ramp at the rim
    }
  }
  ctx.clearRect(0, 0, size, size);
  ctx.putImageData(img, 0, 0);
}

/** The reference ball as a component (self-redrawing). */
export function NormalSphere(props: { dirs: NormalDirs; size: number; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawNormalSphere(ref.current, props.dirs);
  }, [props.dirs, props.size]);
  return (
    <canvas
      ref={ref}
      width={props.size}
      height={props.size}
      className={props.className}
      style={{ width: props.size, height: props.size }}
    />
  );
}

const RED = "#e06666";
const GREEN = "#7bc96f";

function DirButton(props: {
  label: string;
  title: string;
  color: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      aria-label={props.title}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cx(
        "flex h-8 w-8 cursor-pointer items-center justify-center border text-md font-semibold transition",
        props.active ? "border-transparent text-black" : "border-border bg-transparent text-fg-mid hover:border-border-light hover:text-fg",
        props.disabled && "cursor-not-allowed opacity-40",
      )}
      style={props.active ? { background: props.color } : undefined}
    >
      {props.label}
    </button>
  );
}

/**
 * The visual normal-directions editor: a live reference ball with the four channel arrows around
 * it. Click an arrow to point that channel's positive direction — the ball repaints instantly, so
 * "does my engine want green up or down" is answered by looking, not by decoding dropdown text.
 */
export function NormalDirsEditor(props: {
  dirs: NormalDirs;
  onChange: (dirs: NormalDirs) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { dirs, onChange, disabled } = props;
  return (
    <div className={cx("flex flex-col items-start gap-3", disabled && "opacity-60")}>
      <div className="grid w-max grid-cols-[2rem_9rem_2rem] grid-rows-[2rem_9rem_2rem] items-center justify-items-center gap-1">
        <div />
        <DirButton
          label="↑"
          title="Green points up (OpenGL-style)"
          color={GREEN}
          active={dirs.green === "up"}
          disabled={disabled}
          onClick={() => onChange({ ...dirs, green: "up" })}
        />
        <div />
        <DirButton
          label="←"
          title="Red points left"
          color={RED}
          active={dirs.red === "left"}
          disabled={disabled}
          onClick={() => onChange({ ...dirs, red: "left" })}
        />
        <NormalSphere dirs={dirs} size={132} />
        <DirButton
          label="→"
          title="Red points right (standard)"
          color={RED}
          active={dirs.red === "right"}
          disabled={disabled}
          onClick={() => onChange({ ...dirs, red: "right" })}
        />
        <div />
        <DirButton
          label="↓"
          title="Green points down (DirectX-style)"
          color={GREEN}
          active={dirs.green === "down"}
          disabled={disabled}
          onClick={() => onChange({ ...dirs, green: "down" })}
        />
        <div />
      </div>
      <p className="max-w-sm text-base leading-snug text-fg-mid">
        <span style={{ color: RED }}>Red</span> points {dirs.red}, <span style={{ color: GREEN }}>green</span> points{" "}
        {dirs.green} — {dirs.green === "up" ? "the OpenGL convention" : "the DirectX convention"}. The ball is a raised
        hemisphere encoded with this convention; match it against a known-good normal map from your engine.
      </p>
    </div>
  );
}
