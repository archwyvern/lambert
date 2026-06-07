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

function formatNumber(value: number, step: number): string {
  if (step >= 1) return String(Math.round(value));
  return parseFloat(value.toFixed(4)).toString();
}

/**
 * Godot EditorSpinSlider, ported from the skyrat mock editor
 * (packages/inspector/src/fields/SpinSlider.tsx). The whole box is a scrub surface:
 * drag horizontally to adjust (pointer lock = infinite drag, Shift = fine), click
 * without dragging (or Enter/F2) to type, Up/Down to step (Shift = x10). A thin
 * accent bar shows the value within [min,max] when both bounds exist.
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
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  // acc = accumulated movementX since pointer-down; startVal captured so drags don't compound
  const drag = useRef<{ startVal: number; acc: number; moved: boolean } | null>(null);

  const hasRange = min !== undefined && max !== undefined && max > min;
  const ratio = hasRange ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  // ~600px traverses a known range; capped so wide ranges aren't twitchy (tuned for a
  // calm scrub — roughly half the old sensitivity)
  const perPx = hasRange ? Math.min((max - min) / 600, 12 * step) : step * 0.25;

  const clampRound = (v: number): number => {
    let x = v;
    if (min !== undefined) x = Math.max(min, x);
    if (max !== undefined) x = Math.min(max, x);
    if (step >= 1) return Math.round(x);
    x = Math.round(x / step) * step;
    return parseFloat(x.toFixed(6));
  };
  const nudge = (dir: number, coarse: boolean): void => {
    onChange(clampRound(value + dir * step * (coarse ? 10 : 1)));
    onCommit?.();
  };
  const beginEdit = (): void => {
    setText(formatNumber(value, step));
    setEditing(true);
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (editing || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    const lock = el.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (lock && typeof lock.then === "function") lock.catch(() => {}); // lock denial: capture still works
    drag.current = { startVal: value, acc: 0, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    d.acc += e.movementX;
    if (!d.moved && Math.abs(d.acc) < 3) return;
    d.moved = true;
    const fine = e.shiftKey ? 0.1 : 1;
    onChange(clampRound(d.startVal + d.acc * perPx * fine));
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    const el = e.currentTarget as HTMLElement;
    el.releasePointerCapture?.(e.pointerId);
    if (document.pointerLockElement === el) document.exitPointerLock?.();
    if (d && !d.moved) beginEdit();
    else if (d) onCommit?.();
  };

  const commit = (): void => {
    const parsed = parseFloat(text);
    if (!Number.isNaN(parsed)) {
      onChange(clampRound(parsed));
      onCommit?.();
    }
    setEditing(false);
  };

  const control = editing ? (
    <input
      autoFocus
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-[22px] w-full border border-accent bg-surface2 px-1.5 font-mono text-base text-fg outline-none"
    />
  ) : (
    <div
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          beginEdit();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          nudge(1, e.shiftKey);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          nudge(-1, e.shiftKey);
        }
      }}
      className="relative flex h-[22px] w-full cursor-ew-resize items-center gap-1 overflow-hidden border border-border bg-surface2 px-1.5 font-mono text-base text-fg select-none hover:border-accent/50 focus-visible:border-accent focus-visible:outline-none"
      title="Drag to scrub · click or Enter to type · Up/Down to step · Shift = fine"
    >
      {hasRange ? (
        <div
          className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-accent"
          style={{ width: `${ratio * 100}%` }}
        />
      ) : null}
      <span className="pointer-events-none relative flex-1 truncate">{formatNumber(value, step)}</span>
    </div>
  );

  return (
    <div className="flex min-h-[26px] items-center gap-2 py-0.5">
      <span className="min-w-0 flex-1 truncate text-base text-fg-mid" title={label}>
        {label}
      </span>
      <span className="w-1/2 shrink-0">{control}</span>
    </div>
  );
}

/** Compact labeled select (22px form control, column-aligned with SpinBox). */
export function SelectRow(props: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex min-h-[26px] items-center gap-2 py-0.5">
      <span className="min-w-0 flex-1 truncate text-base text-fg-mid">{props.label}</span>
      <select
        className="h-[22px] w-1/2 shrink-0 cursor-pointer border border-border bg-surface2 px-1 text-base text-fg outline-none hover:border-accent/50"
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
