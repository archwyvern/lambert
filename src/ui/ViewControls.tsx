import { CircleHalfFillRegular, ColorFillRegular, GridRegular, ImageRegular, LightbulbRegular, LockClosedRegular, LockOpenRegular, RulerRegular } from "@fluentui/react-icons";
import { IconButton, SpinSlider } from "@carapace/shell";
import type { DocumentStore, EditorState } from "../document/store";
import type { ViewState } from "./App";
import type { ViewMode } from "./preview";

const MODE_META: Record<ViewMode, { icon: React.JSX.Element; label: string }> = {
  diffuse: { icon: <ImageRegular />, label: "Diffuse — the source texture" },
  normal: { icon: <CircleHalfFillRegular />, label: "Normal — the derived normal map" },
  lit: { icon: <LightbulbRegular />, label: "Lit — the normal map under the scene light" },
  coverage: { icon: <ColorFillRegular />, label: "Coverage — red where the diffuse is opaque but no normal is authored" },
};

/**
 * The editor/view control cluster (QC-REQ-6): snap, guide toggles, the normal-view overlay opacity,
 * and the Diffuse/Normal/Lit view modes as icon toggles with tooltips — living in the TopBar's
 * right cluster (user-revised placement), separated from the window controls. Carapace Tooltips.
 */
export function ViewControls(props: {
  store: DocumentStore;
  state: EditorState;
  view: ViewState;
  setView: (fn: (v: ViewState) => ViewState) => void;
  snap: boolean;
  setSnap: (fn: (s: boolean) => boolean) => void;
}): React.JSX.Element {
  const { store, state, view, setView, snap, setSnap } = props;
  const canvas = state.doc.canvas;
  return (
    <div className="flex items-center gap-1">
      <IconButton
        tooltip="Snap positions, vertices, and curve points to the ½px grid"
        label="Grid snap"
        active={snap}
        icon={<GridRegular />}
        onClick={() => setSnap((s) => !s)}
      />
      <IconButton
        tooltip
        label={canvas.snapToGuides ? "Snapping to guides — click to stop" : "Snap to guides"}
        active={canvas.snapToGuides}
        icon={<RulerRegular />}
        onClick={() => store.commit((d) => ({ ...d, canvas: { ...d.canvas, snapToGuides: !d.canvas.snapToGuides } }))}
      />
      <IconButton
        tooltip
        label={canvas.guidesLocked ? "Guides locked — click to unlock" : "Lock guides"}
        active={canvas.guidesLocked}
        icon={canvas.guidesLocked ? <LockClosedRegular /> : <LockOpenRegular />}
        onClick={() => store.commit((d) => ({ ...d, canvas: { ...d.canvas, guidesLocked: !d.canvas.guidesLocked } }))}
      />
      {view.mode === "normal" ? (
        <div className="mx-1 w-24" title="Normal overlay opacity">
          <SpinSlider
            value={Math.round(view.opacity * 100)}
            min={0}
            max={100}
            integer
            suffix="%"
            onChange={(v) => setView((s) => ({ ...s, opacity: v / 100 }))}
          />
        </div>
      ) : null}
      <div className="mx-1 h-4 w-px bg-border" />
      <div role="group" aria-label="View mode" className="flex items-center gap-1">
        {(Object.keys(MODE_META) as ViewMode[]).map((m) => (
          <IconButton
            key={m}
            tooltip={`${MODE_META[m].label} (V cycles)`}
            label={MODE_META[m].label}
            active={view.mode === m}
            icon={MODE_META[m].icon}
            onClick={() => setView((v) => ({ ...v, mode: m }))}
          />
        ))}
      </div>
    </div>
  );
}
