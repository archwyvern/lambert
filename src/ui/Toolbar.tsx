import { ArrowRedoRegular, ArrowUndoRegular } from "@fluentui/react-icons";
import { Badge } from "@carapace/shell";
import type { DocumentStore, EditorState } from "../document/store";
import type { ViewState } from "./App";
import { cx } from "./kit";
import { VIEW_MODES, ViewMode } from "./preview";

const ICON = { fontSize: 16 } as const;

export function Toolbar(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  setView: (fn: (v: ViewState) => ViewState) => void;
}): React.JSX.Element {
  const { store, state, view, setView } = props;
  const pct = Math.round(view.opacity * 100);

  return (
    <header className="flex h-control shrink-0 items-center gap-2 border-b border-border bg-bg px-2">
      <span className="mr-1 shrink-0 px-1 text-base font-semibold text-fg">Lambert</span>

      <div className="flex shrink-0 items-stretch border border-border">
        <button
          title="Undo (Ctrl+Z)"
          disabled={!store.canUndo}
          onClick={() => store.undo()}
          className="flex h-[26px] w-[30px] items-center justify-center border-r border-border text-fg-mid hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <ArrowUndoRegular style={ICON} />
        </button>
        <button
          title="Redo (Ctrl+Y)"
          disabled={!store.canRedo}
          onClick={() => store.redo()}
          className="flex h-[26px] w-[30px] items-center justify-center text-fg-mid hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <ArrowRedoRegular style={ICON} />
        </button>
      </div>

      <span className="mx-2 min-w-0 flex-1 truncate text-base text-fg-mid" title={state.docPath ?? undefined}>
        {state.docPath ?? "unsaved"}
      </span>
      {state.dirty ? (
        <Badge tone="accent" className="shrink-0">
          unsaved
        </Badge>
      ) : null}

      <div className="ml-2 flex shrink-0 items-center gap-2">
        {view.mode === "normal" ? (
          <label className="flex shrink-0 items-center gap-2 text-sm text-fg-mid">
            opacity
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={view.opacity}
              onChange={(e) => setView((v) => ({ ...v, opacity: Number(e.target.value) }))}
              className="h-[3px] w-24 cursor-pointer appearance-none"
              style={{
                background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-border) ${pct}%)`,
              }}
            />
            <span className="w-9 text-right font-mono tabular-nums text-fg">{pct}%</span>
          </label>
        ) : null}
        <div className="flex shrink-0 items-stretch border border-border" role="tablist">
          {VIEW_MODES.map((m: ViewMode) => (
            <button
              key={m}
              role="tab"
              aria-selected={view.mode === m}
              title="View mode (V cycles)"
              onClick={() => setView((v) => ({ ...v, mode: m }))}
              className={cx(
                "h-[26px] border-r border-border px-3 text-base capitalize last:border-r-0",
                view.mode === m ? "bg-list-active text-fg" : "text-fg-mid hover:bg-hover hover:text-fg",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <button
          title="Vector view stays crisp at any zoom; raster view shows the pixelated exported output"
          aria-pressed={view.raster}
          onClick={() => setView((v) => ({ ...v, raster: !v.raster }))}
          className={cx(
            "h-[26px] shrink-0 border border-border px-3 text-base",
            view.raster ? "bg-list-active text-fg" : "text-fg-mid hover:bg-hover hover:text-fg",
          )}
        >
          {view.raster ? "raster" : "vector"}
        </button>
      </div>
    </header>
  );
}
