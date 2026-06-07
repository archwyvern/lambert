import type { DocumentStore, EditorState } from "../document/store";
import type { ViewState } from "./App";
import { LightPad } from "./LightPad";
import { VIEW_MODES, ViewMode } from "./preview";
import { exportNx, openImageFlow, openProjectFlow, saveFlow } from "../document/io";
import { getHost } from "./host";

export function Toolbar(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  setView: (fn: (v: ViewState) => ViewState) => void;
  diffuse: { bytes: Uint8Array; dir: string | null } | null;
  setDiffuse: (d: { bytes: Uint8Array; dir: string | null } | null) => void;
}): React.JSX.Element {
  const { store, state, view, setView, diffuse, setDiffuse } = props;
  const btn = "rounded border border-panel-edge px-2 py-1 hover:border-accent disabled:opacity-40";
  const run = (p: Promise<unknown>): void =>
    void p
      .then((msg) => {
        if (typeof msg === "string") alert(msg);
      })
      .catch((err: unknown) => alert(err instanceof Error ? err.message : String(err)));

  return (
    <header className="flex items-center gap-2 border-b border-panel-edge bg-panel px-3 py-1.5">
      <span className="mr-2 font-semibold">Flatland</span>
      <button className={btn} onClick={() => run(openImageFlow(getHost(), store, setDiffuse))}>
        Open Image
      </button>
      <button className={btn} onClick={() => run(openProjectFlow(getHost(), store, setDiffuse))}>
        Open Project
      </button>
      <button className={btn} disabled={!diffuse} onClick={() => run(saveFlow(getHost(), store, false))}>
        Save
      </button>
      <button className={btn} disabled={!diffuse} onClick={() => run(saveFlow(getHost(), store, true))}>
        Save As
      </button>
      <button className={btn} disabled={!diffuse} onClick={() => run(exportNx(getHost(), store))}>
        Export NX
      </button>
      <span className="mx-2 truncate text-fg-mid">
        {state.docPath ?? "unsaved"}
        {state.dirty ? " *" : ""}
      </span>
      <div className="ml-auto flex items-center gap-3">
        <button className={btn} disabled={!store.canUndo} onClick={() => store.undo()}>
          Undo
        </button>
        <button className={btn} disabled={!store.canRedo} onClick={() => store.redo()}>
          Redo
        </button>
        <select
          className="rounded border border-panel-edge bg-canvasbg px-1 py-1"
          value={view.mode}
          onChange={(e) => setView((v) => ({ ...v, mode: e.target.value as ViewMode }))}
        >
          {VIEW_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {view.mode === "height" || view.mode === "normal" ? (
          <label className="flex items-center gap-1 text-fg-mid">
            opacity
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={view.opacity}
              onChange={(e) => setView((v) => ({ ...v, opacity: Number(e.target.value) }))}
            />
            <span className="w-10 text-right">{Math.round(view.opacity * 100)}%</span>
          </label>
        ) : null}
        <LightPad lightDir={view.lightDir} onChange={(d) => setView((v) => ({ ...v, lightDir: d }))} />
      </div>
    </header>
  );
}
