import {
  ArrowExportRegular,
  ArrowRedoRegular,
  ArrowUndoRegular,
  FolderOpenRegular,
  ImageRegular,
  SaveEditRegular,
  SaveRegular,
} from "@fluentui/react-icons";
import type { DocumentStore, EditorState } from "../document/store";
import type { ViewState } from "./App";
import { Button } from "./kit";
import { LightPad } from "./LightPad";
import { VIEW_MODES, ViewMode } from "./preview";
import { exportNx, openImageFlow, openProjectFlow, saveFlow } from "../document/io";
import { getHost } from "./host";

const ICON = { fontSize: 14 } as const;

export function Toolbar(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  setView: (fn: (v: ViewState) => ViewState) => void;
  diffuse: { bytes: Uint8Array; dir: string | null } | null;
  setDiffuse: (d: { bytes: Uint8Array; dir: string | null } | null) => void;
  run: (p: Promise<unknown>) => void;
}): React.JSX.Element {
  const { store, state, view, setView, diffuse, setDiffuse, run } = props;
  const pct = Math.round(view.opacity * 100);

  return (
    <header className="flex h-control shrink-0 items-center gap-2 border-b border-border bg-surface2 px-3">
      <span className="mr-1 shrink-0 text-md font-semibold uppercase tracking-[var(--tracking-label)] text-accent">
        Flatland
      </span>
      <Button title="Open Image (Ctrl+O)" onClick={() => run(openImageFlow(getHost(), store, setDiffuse))}>
        <ImageRegular style={ICON} />
      </Button>
      <Button title="Open Project (Ctrl+Shift+O)" onClick={() => run(openProjectFlow(getHost(), store, setDiffuse))}>
        <FolderOpenRegular style={ICON} />
      </Button>
      <Button title="Save (Ctrl+S)" disabled={!diffuse} onClick={() => run(saveFlow(getHost(), store, false))}>
        <SaveRegular style={ICON} />
      </Button>
      <Button title="Save As (Ctrl+Shift+S)" disabled={!diffuse} onClick={() => run(saveFlow(getHost(), store, true))}>
        <SaveEditRegular style={ICON} />
      </Button>
      <Button
        variant="primary"
        title="Export the .nx.png next to the diffuse (Ctrl+E)"
        disabled={!diffuse}
        onClick={() => run(exportNx(getHost(), store))}
      >
        <ArrowExportRegular style={ICON} /> Export NX
      </Button>
      <span className="mx-2 min-w-0 flex-1 truncate text-sm text-fg-mid" title={state.docPath ?? undefined}>
        {state.docPath ?? "unsaved"}
      </span>
      {state.dirty ? (
        <span className="shrink-0 border border-accent-dim bg-accent-faint px-1.5 text-sm uppercase tracking-[var(--tracking-tight)] text-accent">
          unsaved
        </span>
      ) : null}
      <div className="ml-2 flex shrink-0 items-center gap-2">
        <Button disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (Ctrl+Z)">
          <ArrowUndoRegular style={ICON} />
        </Button>
        <Button disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (Ctrl+Y)">
          <ArrowRedoRegular style={ICON} />
        </Button>
        <select
          className="h-[22px] shrink-0 cursor-pointer border border-border bg-surface px-1 text-sm uppercase tracking-[var(--tracking-tight)] text-fg outline-none"
          value={view.mode}
          onChange={(e) => setView((v) => ({ ...v, mode: e.target.value as ViewMode }))}
          title="View mode (V cycles)"
        >
          {VIEW_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {view.mode === "height" || view.mode === "normal" ? (
          <label className="flex shrink-0 items-center gap-2 text-sm uppercase tracking-[var(--tracking-tight)] text-fg-mid">
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
            <span className="w-9 text-right tabular-nums text-fg">{pct}%</span>
          </label>
        ) : null}
        <LightPad lightDir={view.lightDir} onChange={(d) => setView((v) => ({ ...v, lightDir: d }))} />
      </div>
    </header>
  );
}
