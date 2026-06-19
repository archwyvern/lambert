import { cx } from "./kit";

export interface TabInfo {
  imagePath: string;
  name: string;
  dirty: boolean;
}

/** Viewport tab bar: one tab per open image, active highlighted, dirty dot, close button. */
export function Tabs(props: {
  tabs: TabInfo[];
  activeIndex: number;
  onSelect: (i: number) => void;
  onClose: (imagePath: string) => void;
}): React.JSX.Element {
  const { tabs, activeIndex, onSelect, onClose } = props;
  if (tabs.length === 0) return <div className="h-[30px] shrink-0 border-b border-border bg-bg" />;
  return (
    <div className="flex h-[30px] shrink-0 items-stretch overflow-x-auto border-b border-border bg-bg">
      {tabs.map((t, i) => {
        const active = i === activeIndex;
        return (
          <div
            key={t.imagePath}
            role="tab"
            aria-selected={active}
            onPointerDown={() => onSelect(i)}
            className={cx(
              "group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 text-base whitespace-nowrap",
              active ? "bg-surface2 text-fg" : "text-fg-mid hover:bg-hover hover:text-fg",
            )}
          >
            <span className="max-w-[160px] truncate">{t.name}</span>
            {t.dirty ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="unsaved" /> : null}
            <button
              title="Close"
              onPointerDown={(e) => {
                e.stopPropagation();
                onClose(t.imagePath);
              }}
              className={cx(
                "flex h-4 w-4 shrink-0 items-center justify-center text-fg-mid hover:bg-hover hover:text-fg",
                active ? "" : "opacity-0 group-hover:opacity-100",
              )}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
