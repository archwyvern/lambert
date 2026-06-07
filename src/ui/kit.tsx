import { ChevronDownRegular, ChevronUpRegular } from "@fluentui/react-icons";
import { useRef, useState } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** camelCase identifier -> spaced label ("slopeWidth" -> "slope width"). */
export function humanizeLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

export type ButtonVariant = "primary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border cursor-pointer " +
  "transition disabled:cursor-not-allowed h-[26px] px-2.5 text-base";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent-dim border-accent/50 text-accent hover:bg-accent/25 disabled:opacity-50",
  ghost: "bg-transparent border-border text-fg hover:bg-hover hover:border-border-light disabled:opacity-50",
  danger: "bg-transparent border-error/40 text-error hover:bg-error/15 disabled:opacity-50",
};

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant },
): React.JSX.Element {
  const { variant = "ghost", className, ...rest } = props;
  return <button className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)} {...rest} />;
}

/** Panel section header (vscode-style: small caps band). */
export function SectionLabel(props: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cx("mb-1.5 text-sm font-semibold uppercase tracking-wide text-fg-mid", props.className)}>
      {props.children}
    </div>
  );
}

const SCRUB_PX_PER_STEP = 4;

const roundTo = (v: number, decimals: number): number => Number(v.toFixed(decimals));

/**
 * Spinbox: numeric input + stepper chevrons; the label is a scrubby slider
 * (drag horizontally; Alt = fine x0.1, Shift = coarse x10).
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

  const clamp = (v: number, effectiveStep = step): number => {
    let r = v;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return roundTo(r, effectiveStep < 1 ? 2 : 0);
  };

  const bump = (dir: 1 | -1): void => {
    onChange(clamp(value + dir * step));
    onCommit?.();
  };

  return (
    <label className="flex min-h-[26px] items-center justify-between gap-2 py-0.5">
      <span
        className="cursor-ew-resize truncate select-none text-base text-fg-mid"
        title="Drag to adjust (Alt = fine, Shift = coarse)"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          scrub.current = { startX: e.clientX, startValue: value };
        }}
        onPointerMove={(e) => {
          if (!scrub.current) return;
          const factor = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
          const effectiveStep = step * factor;
          const steps = Math.round((e.clientX - scrub.current.startX) / SCRUB_PX_PER_STEP);
          onChange(clamp(scrub.current.startValue + steps * effectiveStep, effectiveStep));
        }}
        onPointerUp={() => {
          scrub.current = null;
          onCommit?.();
        }}
      >
        {label}
      </span>
      <span className="flex h-[22px] items-stretch border border-border bg-surface2 focus-within:border-accent/50">
        <input
          type="number"
          className="w-16 bg-transparent px-1.5 text-right font-mono text-base tabular-nums text-fg outline-none"
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
            className="flex h-[11px] w-4 items-center justify-center text-fg-mid hover:bg-hover hover:text-fg"
            onClick={() => bump(1)}
          >
            <ChevronUpRegular style={{ fontSize: 11 }} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="flex h-[11px] w-4 items-center justify-center border-t border-border text-fg-mid hover:bg-hover hover:text-fg"
            onClick={() => bump(-1)}
          >
            <ChevronDownRegular style={{ fontSize: 11 }} />
          </button>
        </span>
      </span>
    </label>
  );
}

/** Compact labeled select (22px vscode form control). */
export function SelectRow(props: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex min-h-[26px] items-center justify-between gap-2 py-0.5">
      <span className="truncate text-base text-fg-mid">{props.label}</span>
      <select
        className="h-[22px] cursor-pointer border border-border bg-surface2 px-1.5 text-base text-fg outline-none hover:bg-hover"
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

export interface ToastState {
  msg: string;
  tone: "info" | "error";
}

/** Non-modal bottom-right toast (replaces alert() for save/export feedback). */
export function Toast(props: { toast: ToastState | null }): React.JSX.Element | null {
  if (!props.toast) return null;
  const border = props.toast.tone === "error" ? "border-error/60" : "border-link/60";
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50">
      <div
        className={cx(
          "animate-fade-in max-w-[420px] border bg-surface2 px-3 py-2 text-base text-fg shadow-[var(--shadow-popover)]",
          border,
        )}
      >
        {props.toast.msg}
      </div>
    </div>
  );
}
