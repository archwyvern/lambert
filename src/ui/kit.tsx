import { ChevronDownRegular, ChevronUpRegular } from "@fluentui/react-icons";
import { useRef, useState } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 uppercase tracking-[var(--tracking-label)] " +
  "border cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1 text-sm";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent-faint border-accent-dim text-accent hover:bg-accent/15",
  ghost: "bg-transparent border-border text-fg-mid hover:text-fg hover:bg-accent-faint",
  danger: "bg-error-faint border-error/40 text-error hover:bg-error/15",
};

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant },
): React.JSX.Element {
  const { variant = "ghost", className, ...rest } = props;
  return <button className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)} {...rest} />;
}

/** Uppercase tracked section label (panel headings). */
export function SectionLabel(props: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <div
      className={cx(
        "mb-2 text-sm font-semibold uppercase tracking-[var(--tracking-section)] text-fg-mid",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

const SCRUB_PX_PER_STEP = 4;

/**
 * Spinbox: numeric input + stepper chevrons; the label is a Photoshop-style scrubby
 * slider (drag horizontally to adjust). Arrow keys work on the input natively.
 */
export function SpinBox(props: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
}): React.JSX.Element {
  const { label, value, step = 1, min, max, onChange, onCommit } = props;
  const scrub = useRef<{ startX: number; startValue: number } | null>(null);
  const [text, setText] = useState<string | null>(null);

  const clamp = (v: number): number => {
    let r = v;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    // snap away float noise from scrubbing/stepping
    const decimals = step < 1 ? 2 : 0;
    return Number(r.toFixed(decimals));
  };

  const bump = (dir: 1 | -1): void => {
    onChange(clamp(value + dir * step));
    onCommit?.();
  };

  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span
        className="cursor-ew-resize select-none text-sm text-fg-mid"
        title="Drag to adjust"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          scrub.current = { startX: e.clientX, startValue: value };
        }}
        onPointerMove={(e) => {
          if (!scrub.current) return;
          const steps = Math.round((e.clientX - scrub.current.startX) / SCRUB_PX_PER_STEP);
          onChange(clamp(scrub.current.startValue + steps * step));
        }}
        onPointerUp={() => {
          scrub.current = null;
          onCommit?.();
        }}
      >
        {label}
      </span>
      <span className="flex h-[22px] items-stretch border border-border bg-surface">
        <input
          type="number"
          className="w-16 bg-transparent px-1 text-right text-sm tabular-nums text-fg outline-none focus:bg-surface3"
          value={text ?? String(value)}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v)) onChange(clamp(v));
          }}
          onBlur={() => {
            setText(null);
            onCommit?.();
          }}
        />
        <span className="flex flex-col border-l border-border">
          <button
            type="button"
            tabIndex={-1}
            className="flex h-[11px] w-4 items-center justify-center text-fg-mid hover:bg-surface3 hover:text-accent"
            onClick={() => bump(1)}
          >
            <ChevronUpRegular style={{ fontSize: 9 }} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="flex h-[11px] w-4 items-center justify-center border-t border-border text-fg-mid hover:bg-surface3 hover:text-accent"
            onClick={() => bump(-1)}
          >
            <ChevronDownRegular style={{ fontSize: 9 }} />
          </button>
        </span>
      </span>
    </label>
  );
}

/** Compact labeled select in the skyrat form style. */
export function SelectRow(props: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-sm text-fg-mid">{props.label}</span>
      <select
        className="h-[22px] cursor-pointer border border-border bg-surface px-1 text-sm text-fg outline-none"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
