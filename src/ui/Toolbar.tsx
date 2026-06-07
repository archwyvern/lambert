import {
  ArrowExportRegular,
  ArrowRedoRegular,
  ArrowUndoRegular,
  FolderOpenRegular,
  ImageRegular,
  SaveRegular,
} from "@fluentui/react-icons";
import type { DocumentStore, EditorState } from "../document/store";
import type { ViewState } from "./App";
import { Button } from "./kit";
import { LightPad } from "./LightPad";
import { VIEW_MODES, ViewMode } from "./preview";
import { exportNx, openImageFlow, openProjectFlow, saveFlow } from "../document/io";
import { getHost } from "./host";

const ICON = { fontSize: 13 } as const;

export function Toolbar(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  setView: (fn: (v: ViewState) => ViewState) => void;
  diffuse: { bytes: Uint8Array; dir: string | null } | null;
  setDiffuse: (d: { bytes: Uint8Array; dir: string | null } | null) => void;
}): React.JSX.Element {
  const { store, state, view, setView, diffuse, setDiffuse } = props;
  const run = (p: Promise<unknown>): void =>
    void p
      .then((msg) => {
        if (typeof msg === "string") alert(msg);
      })
      .catch((err: unknown) => alert(err instanceof Error ? err.message : String(err)));
  const pct = Math.round(view.opacity * 100);

  return (
    <header className="flex h-control shrink-0 items-center gap-2 border-b border-border bg-surface2 px-3">
      <span className="mr-1 text-md font-semibold text-accent">Flatland</span>
      <Button onClick={() => run(openImageFlow(getHost(), store, setDiffuse))}>
        <ImageRegular style={ICON} /> Open Image
      </Button>
      <Button onClick={() => run(openProjectFlow(getHost(), store, setDiffuse))}>
        <FolderOpenRegular style={ICON} /> Open Project
      </Button>
      <Button disabled={!diffuse} onClick={() => run(saveFlow(getHost(), store, false))}>
        <SaveRegular style={ICON} /> Save
      </Button>
      <Button disabled={!diffuse} onClick={() => run(saveFlow(getHost(), store, true))}>
        Save As
      </Button>
      <Button variant="primary" disabled={!diffuse} onClick={() => run(exportNx(getHost(), store))}>
        <ArrowExportRegular style={ICON} /> Export NX
      </Button>
      <span className="mx-2 min-w-0 truncate text-sm text-fg-mid">
        {state.docPath ?? "unsaved"}
        {state.dirty ? <span className="text-accent"> *</span> : null}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <Button disabled={!store.canUndo} onClick={() => store.undo()} title="Ctrl+Z">
          <ArrowUndoRegular style={ICON} />
        </Button>
        <Button disabled={!store.canRedo} onClick={() => store.redo()} title="Ctrl+Y">
          <ArrowRedoRegular style={ICON} />
        </Button>
        <select
          className="h-[22px] cursor-pointer border border-border bg-surface px-1 text-sm uppercase tracking-[var(--tracking-tight)] text-fg outline-none"
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
          <label className="flex items-center gap-2 text-sm uppercase tracking-[var(--tracking-tight)] text-fg-mid">
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
