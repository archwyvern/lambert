import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** camelCase identifier -> spaced label ("slopeWidth" -> "slope width"). */
export function humanizeLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

export type MenuEntry =
  | { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hotkey?: string }
  | "separator";

/** Cursor-anchored popup menu. Closes on outside pointer/scroll/resize/blur/Escape, and flips so it
 *  never opens off the right/bottom edge of the window. */
export function ContextMenu(props: { x: number; y: number; items: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  const { onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useEffect(() => {
    const opts = { passive: true } as const;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", onClose, opts);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  // flip/clamp within the viewport so edge-of-window right-clicks stay fully reachable
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const m = 4;
    const left = props.x + r.width > window.innerWidth - m ? Math.max(m, window.innerWidth - r.width - m) : props.x;
    const top = props.y + r.height > window.innerHeight - m ? Math.max(m, window.innerHeight - r.height - m) : props.y;
    setPos({ left, top });
  }, [props.x, props.y]);
  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[170px] border border-border-light bg-surface2 py-0.5 shadow-[var(--shadow-popover)]"
      style={{ left: pos.left, top: pos.top }}
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
              "flex w-full items-center justify-between gap-6 px-3 py-1 text-left text-base disabled:opacity-40",
              it.danger ? "text-error hover:bg-error/10" : "text-fg-mid hover:bg-hover hover:text-fg",
            )}
          >
            <span>{it.label}</span>
            {it.hotkey ? <span className="font-mono text-sm text-fg-mid">{it.hotkey}</span> : null}
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

export interface ToastState {
  msg: string;
  tone: "info" | "error";
}
