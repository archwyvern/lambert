import { TopBar } from "@carapace/shell";
import type { MenuModel } from "@carapace/shell";
import { LambertMark } from "./LambertMark";

/**
 * App chrome (QC-REQ-6): carapace's shell TopBar — logo + in-window menu on the left, the
 * editor/view controls (ViewControls) on the right, separated from the window controls by a
 * divider. The centre stays EMPTY on purpose: it is the frameless window's drag region, and the
 * document identity already lives in the tab strip (name + dirty dot) and the window title.
 * Undo/redo live in the Edit menu + Ctrl+Z/Y only.
 */
export function Toolbar(props: {
  menu: MenuModel;
  /** The view-control cluster (rendered by App with its state wiring). */
  controls?: React.ReactNode;
}): React.JSX.Element {
  const { menu, controls } = props;
  return (
    <TopBar
      logo={<LambertMark className="ml-1 h-control-xs w-control-xs shrink-0" />}
      menu={menu}
      draggable
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
