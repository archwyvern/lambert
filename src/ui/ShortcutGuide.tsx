import { useState } from "react";
import type { GuideSection } from "./keymap";

/**
 * Always-available, collapsible shortcut cheat-sheet docked bottom-right of a viewport. Collapsed it
 * is a small pill (so it never hides the view); expanded it lists the contextual keys/gestures.
 * Open/closed is remembered per `storageKey`. The panel swallows its own pointer events so clicks on
 * it never start a canvas drag.
 */
export function ShortcutGuide(props: {
  sections: GuideSection[];
  storageKey: string;
  defaultOpen?: boolean;
}): React.JSX.Element {
  const { sections, storageKey, defaultOpen = false } = props;
  const [open, setOpen] = useState<boolean>(() => {
    const v = localStorage.getItem(storageKey);
    return v == null ? defaultOpen : v === "1";
  });
  const toggle = (): void =>
    setOpen((o) => {
      localStorage.setItem(storageKey, o ? "0" : "1");
      return !o;
    });
  const stop = (e: React.PointerEvent): void => e.stopPropagation();

  if (!open) {
    return (
      <button
        type="button"
        onPointerDown={stop}
        onClick={toggle}
        title="Show shortcuts"
        className="absolute right-2 bottom-2 z-10 flex items-center gap-1 border border-border bg-surface2/80 px-2 py-0.5 text-sm text-fg-mid opacity-80 hover:opacity-100 hover:text-fg"
      >
        <span aria-hidden>⌨</span> Shortcuts
      </button>
    );
  }

  return (
    <div
      onPointerDown={stop}
      onWheel={(e) => e.stopPropagation()}
      className="absolute right-2 bottom-2 z-10 flex max-h-[60%] w-56 flex-col overflow-hidden border border-border bg-surface2/90 text-sm shadow-lg backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={toggle}
        title="Hide shortcuts"
        className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1 text-fg-mid hover:text-fg"
      >
        <span className="font-semibold tracking-[var(--tracking-tight)] uppercase">Shortcuts</span>
        <span aria-hidden>▾</span>
      </button>
      <div className="flex flex-col gap-2 overflow-y-auto p-2">
        {sections.map((s) => (
          <div key={s.title} className="flex flex-col gap-0.5">
            <div className="text-sm font-semibold tracking-[var(--tracking-tight)] text-accent uppercase">{s.title}</div>
            {s.rows.map((r, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2">
                <span className="shrink-0 font-mono text-sm text-fg">{r.keys}</span>
                <span className="text-right text-sm text-fg-mid">{r.desc}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
