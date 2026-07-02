import { SaveStatus, TopBar } from "@carapace/shell";
import type { MenuModel } from "@carapace/shell";
import { LambertMark } from "./LambertMark";
import type { DocumentStore, EditorState } from "../document/store";

/**
 * App chrome (QC-REQ-6, placement revised by user): carapace's shell TopBar — logo + in-window
 * menu, the document identity (path + unsaved badge) pinned to the window centre, and the
 * editor/view controls (ViewControls) on the right, separated from the window controls by a
 * divider. Undo/redo live in the Edit menu + Ctrl+Z/Y only.
 */
export function Toolbar(props: {
  menu: MenuModel;
  state?: EditorState;
  /** The view-control cluster (rendered by App with its state wiring). */
  controls?: React.ReactNode;
}): React.JSX.Element {
  const { menu, state, controls } = props;
  // split the active path so the FILENAME (the primary identity) reads brighter than its directory
  const path = state?.docPath ?? null;
  const slash = path ? path.lastIndexOf("/") : -1;
  const dirPart = slash >= 0 ? path!.slice(0, slash + 1) : "";
  const fileName = path ? path.slice(slash + 1) : null;

  return (
    <TopBar
      logo={<LambertMark className="ml-1 h-control-xs w-control-xs shrink-0" />}
      menu={menu}
      draggable
      center={
        state ? (
          <span className="flex max-w-[40vw] items-baseline gap-2 text-base">
            <span className="flex min-w-0 items-baseline">
              {fileName ? (
                <>
                  <span className="truncate text-fg-mid">{dirPart}</span>
                  <span className="shrink-0 text-fg">{fileName}</span>
                </>
              ) : (
                <span className="text-fg-mid">Untitled</span>
              )}
            </span>
            <SaveStatus status={state.dirty ? "unsaved" : "saved"} className="shrink-0" />
          </span>
        ) : undefined
      }
      actions={
        controls ? (
          <>
            {controls}
            <div className="mx-1.5 h-4 w-px bg-border" />
          </>
        ) : undefined
      }
    />
  );
}
