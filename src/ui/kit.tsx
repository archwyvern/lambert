import { useEffect } from "react";
import { SpinSlider } from "@carapace/shell";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** camelCase identifier -> spaced label ("slopeWidth" -> "slope width"). */
export function humanizeLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

export type MenuEntry = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean } | "separator";

/** Cursor-anchored popup menu. Closes on any outside pointer/scroll/resize/blur. */
export function ContextMenu(props: { x: number; y: number; items: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  const { onClose } = props;
  useEffect(() => {
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", onClose, opts);
    return () => {
      window.removeEventListener("pointerdown", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, [onClose]);
  return (
    <div
      className="fixed z-50 min-w-[170px] border border-border-light bg-surface2 py-0.5 shadow-[var(--shadow-popover)]"
      style={{ left: props.x, top: props.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.items.map((it, i) =>
        it === "separator" ? (
          <div key={i} className="my-0.5 border-t border-border" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              it.onClick();
              onClose();
            }}
            className={cx(
              "block w-full px-3 py-1 text-left text-base disabled:opacity-40",
              it.danger ? "text-error hover:bg-error/10" : "text-fg-mid hover:bg-hover hover:text-fg",
            )}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
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

// Button stays lambert-local: carapace's Button has no `danger` variant and uses a
// rounded/filled look rather than this bordered vscode style. Swap once carapace
// grows a destructive variant.
export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant },
): React.JSX.Element {
  const { variant = "ghost", className, ...rest } = props;
  return <button className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)} {...rest} />;
}

/** Panel section header (vscode-style: small caps band). Kept over carapace's
 *  SectionHeader, whose edge-to-edge band doesn't fit lambert's p-3 padded panels. */
export function SectionLabel(props: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cx("mb-1.5 text-sm font-semibold uppercase tracking-wide text-fg-mid", props.className)}>
      {props.children}
    </div>
  );
}

/**
 * Labelled number field: carapace's SpinSlider (drag-scrub + click-to-type +
 * expr eval) in carapace's stacked FormSlider layout, but with OPTIONAL bounds —
 * lambert's transform fields are unbounded, which carapace's FormSlider can't express.
 */
export function NumberField(props: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}): React.JSX.Element {
  const { label, value, step, min, max, onChange, onCommit } = props;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="truncate text-sm text-fg-mid" title={label}>
        {label}
      </span>
      <SpinSlider
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        min={min}
        max={max}
        step={step}
        integer={(step ?? 1) >= 1}
      />
    </div>
  );
}

export interface ToastState {
  msg: string;
  tone: "info" | "error";
}

/** VSCode-style bottom status bar: latest message on the left, context info on the right. */
export function StatusBar(props: { message: ToastState | null; right?: React.ReactNode }): React.JSX.Element {
  const { message, right } = props;
  return (
    <footer className="flex h-[22px] shrink-0 items-center justify-between gap-4 border-t border-border bg-surface2 px-3 text-sm">
      <span className={cx("min-w-0 truncate", message?.tone === "error" ? "text-error" : "text-fg-mid")}>
        {message?.msg ?? ""}
      </span>
      {right ? <span className="shrink-0 tabular-nums text-fg-mid">{right}</span> : null}
    </footer>
  );
}
