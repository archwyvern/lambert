// tailwind-merge-aware cx (clsx semantics + later utilities win), from carapace so a passed
// `className` reliably overrides a component's built-in classes. Imported here for kit's own use and
// re-exported so existing `from "./kit"` call sites don't churn.
import { cx, Menu } from "@carapace/shell";
import type { MenuItem } from "@carapace/shell";
export { cx };

/** Inline Fluent-icon pixel sizes (used as the icon's `fontSize`) — one small scale instead of
 *  scattered magic 12/13/14/20 (the Layers row mixed 12 and 13 on sibling icons). */
export const ICON = { xs: 12, sm: 13, md: 14, lg: 20 } as const;

export type MenuEntry =
  | { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hotkey?: string }
  | "separator";

/** Cursor-anchored popup menu: a thin adapter over carapace's floating-ui Menu that keeps lambert's
 *  ergonomic MenuEntry authoring object. carapace's Menu portals, positions/flips at the cursor, and
 *  closes on outside-press/Escape; it also insulates its own pointer events, so it fires correctly
 *  even when rendered inside the canvas's pointer-capturing surface (the bug that previously kept a
 *  lambert-local copy here was carapace leaking pointerdown to host gesture handlers — now fixed). */
export function ContextMenu(props: { x: number; y: number; items: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  const items: MenuItem[] = props.items.map((it) =>
    it === "separator"
      ? { separator: true }
      : { label: it.label, danger: it.danger, enabled: !it.disabled, shortcut: it.hotkey, run: it.onClick },
  );
  return (
    <Menu
      items={items}
      open
      anchor={{ x: props.x, y: props.y }}
      onOpenChange={(o) => {
        if (!o) props.onClose();
      }}
    />
  );
}

export type ButtonVariant = "primary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border cursor-pointer " +
  "transition disabled:cursor-not-allowed h-control-md px-2.5 text-base";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent-dim border-accent/50 text-accent hover:bg-accent/25 disabled:opacity-50",
  ghost: "bg-transparent border-border text-fg hover:bg-hover hover:border-border-light disabled:opacity-50",
  danger: "bg-transparent border-error/40 text-error hover:bg-error/15 disabled:opacity-50",
};

// Button stays lambert-local for the flat, bordered vscode look (BUTTON_BASE). carapace's Button
// now has matching `ghost`/`danger` variants, but renders rounded + lit-from-above filled; adopt it
// (or add a `bordered` variant upstream) when that heavier look is wanted here.
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
