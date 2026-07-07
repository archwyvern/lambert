import {
  ArrowExpandRegular,
  ArrowMoveRegular,
  ArrowRotateClockwiseRegular,
  CursorRegular,
  PenRegular,
  RulerRegular,
  SquareHintRegular,
} from "@fluentui/react-icons";
import { IconButton } from "@carapace/shell";
import type { ToolMode } from "./tools";

/** The canvas tools as a single-column vertical palette, docked to the right of the left sidebar.
 *  Keyboard shortcuts (Photoshop-style; see commands.ts) are owned by App's keymap, not these
 *  buttons — `keyFor` supplies the EFFECTIVE binding so tooltips track rebinds. */
const TOOLS: Array<{ id: ToolMode; label: string; Icon: typeof CursorRegular }> = [
  { id: "select", label: "Select", Icon: CursorRegular },
  { id: "move", label: "Move", Icon: ArrowMoveRegular },
  { id: "rotate", label: "Rotate", Icon: ArrowRotateClockwiseRegular },
  { id: "scale", label: "Scale", Icon: ArrowExpandRegular },
  // SquareHint = a box drawn as its four corner nodes — reads as "edit the vertices", where the
  // old bezier-curve glyph read as a hill
  { id: "vertex", label: "Edit Vertices", Icon: SquareHintRegular },
  { id: "pen", label: "Mask Pen", Icon: PenRegular },
  { id: "measure", label: "Measure", Icon: RulerRegular },
];

export function ToolPalette(props: {
  tool: ToolMode;
  setTool: (t: ToolMode) => void;
  /** Effective chord for a tool (rebind-aware); null/undefined = unbound, tooltip shows no key. */
  keyFor: (tool: ToolMode) => string | null | undefined;
}): React.JSX.Element {
  const { tool, setTool, keyFor } = props;
  return (
    <div className="shrink-0 border-l border-border bg-bg p-2">
      <div className="grid grid-cols-1 gap-1">
        {TOOLS.map(({ id, label, Icon }) => {
          const key = keyFor(id);
          return (
            <IconButton
              key={id}
              size="md"
              className="h-control-lg w-control-lg"
              active={tool === id}
              label={label}
              tooltip={key ? `${label} (${key})` : label}
              icon={<Icon />}
              onClick={() => setTool(id)}
            />
          );
        })}
      </div>
    </div>
  );
}
