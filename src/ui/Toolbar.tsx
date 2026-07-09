import { TopBar } from "@carapace/shell";
import type { MenuModel } from "@carapace/shell";
import { LambertMark } from "./LambertMark";

/**
 * App chrome (QC-REQ-6): carapace's shell TopBar — logo + in-window menu on the left. The centre
 * stays EMPTY on purpose: it is the frameless window's drag region, and the document identity
 * already lives in the tab strip (name + dirty dot) and the window title. The view/snap/mode
 * controls now live in a strip atop the editor (see DocEditor), so the embed carries them too.
 * Undo/redo live in the Edit menu + Ctrl+Z/Y only.
 */
export function Toolbar(props: { menu: MenuModel }): React.JSX.Element {
  return (
    <TopBar
      logo={<LambertMark className="ml-1 h-control-xs w-control-xs shrink-0" />}
      menu={props.menu}
      draggable
    />
  );
}
