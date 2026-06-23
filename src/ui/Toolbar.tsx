import { ArrowRedoRegular, ArrowUndoRegular } from "@fluentui/react-icons";
import { Badge, IconButton, MenuBar } from "@carapace/shell";
import type { MenuModel } from "@carapace/shell";
import { LambertMark } from "./LambertMark";
import type { DocumentStore, EditorState } from "../document/store";
import type { ViewState } from "./App";
import { cx } from "./kit";
import { VIEW_MODES, ViewMode } from "./preview";

/** Always-present VS Code-style top bar: logo + in-window menu bar. The file-editing controls
 *  (undo/redo, doc path, view toggles) only appear once an image is open. */
export function Toolbar(props: {
  menu: MenuModel;
  store?: DocumentStore;
  state?: EditorState;
  view?: ViewState;
  setView?: (fn: (v: ViewState) => ViewState) => void;
  snap: boolean;
  setSnap: (fn: (s: boolean) => boolean) => void;
}): React.JSX.Element {
  const { menu, store, state, view, setView, snap, setSnap } = props;
  return (
    <header className="flex h-control shrink-0 items-center gap-2 border-b border-border bg-bg px-2">
      <LambertMark className="ml-1 h-[18px] w-[18px] shrink-0" />
      <MenuBar menu={menu} />
      {store && state && view && setView ? (
        <FileControls store={store} state={state} view={view} setView={setView} snap={snap} setSnap={setSnap} />
      ) : null}
    </header>
  );
}

function FileControls(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  setView: (fn: (v: ViewState) => ViewState) => void;
  snap: boolean;
  setSnap: (fn: (s: boolean) => boolean) => void;
}): React.JSX.Element {
  const { store, state, view, setView, snap, setSnap } = props;
  const pct = Math.round(view.opacity * 100);

  return (
    <>
      <div className="ml-1 flex shrink-0 items-stretch overflow-hidden border border-border">
        <IconButton
          size="md"
          className="h-[26px] w-[30px] rounded-none border-r border-border"
          label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={!store.canUndo}
          icon={<ArrowUndoRegular />}
          onClick={() => store.undo()}
        />
        <IconButton
          size="md"
          className="h-[26px] w-[30px] rounded-none"
          label="Redo"
          title="Redo (Ctrl+Y)"
          disabled={!store.canRedo}
          icon={<ArrowRedoRegular />}
          onClick={() => store.redo()}
        />
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
        <button
          title="Snap positions, vertices, and curve points to the ½px grid"
          aria-pressed={snap}
          onClick={() => setSnap((s) => !s)}
          className={cx(
            "h-[26px] shrink-0 border border-border px-3 text-base",
            snap ? "bg-list-active text-fg" : "text-fg-mid hover:bg-hover hover:text-fg",
          )}
        >
          snap
        </button>
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
        {view.mode === "lit" || view.mode === "normal" ? (
          <button
            title="Preview the full Skyrat pipeline: alpha-volume bevel + this NX override + radial + gradient"
            aria-pressed={view.fullPipeline}
            onClick={() => setView((v) => ({ ...v, fullPipeline: !v.fullPipeline }))}
            className={cx(
              "h-[26px] shrink-0 border border-border px-3 text-base",
              view.fullPipeline ? "bg-list-active text-fg" : "text-fg-mid hover:bg-hover hover:text-fg",
            )}
          >
            full
          </button>
        ) : null}
      </div>
    </>
  );
}
