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
 *  Keyboard shortcuts (QWERT) are owned by App's keydown handler, not these buttons. */
const TOOLS: Array<{ id: ToolMode; key: string; label: string; Icon: typeof CursorRegular }> = [
  { id: "select", key: "Q", label: "Select", Icon: CursorRegular },
  { id: "move", key: "W", label: "Move", Icon: ArrowMoveRegular },
  { id: "rotate", key: "E", label: "Rotate", Icon: ArrowRotateClockwiseRegular },
  { id: "scale", key: "R", label: "Scale", Icon: ArrowExpandRegular },
  // SquareHint = a box drawn as its four corner nodes — reads as "edit the vertices", where the
  // old bezier-curve glyph read as a hill
  { id: "vertex", key: "T", label: "Edit Vertices", Icon: SquareHintRegular },
  { id: "pen", key: "P", label: "Mask Pen", Icon: PenRegular },
  { id: "measure", key: "M", label: "Measure", Icon: RulerRegular },
];

export function ToolPalette(props: { tool: ToolMode; setTool: (t: ToolMode) => void }): React.JSX.Element {
  const { tool, setTool } = props;
  return (
    <div className="shrink-0 border-l border-border bg-bg p-2">
      <div className="grid grid-cols-1 gap-1">
        {TOOLS.map(({ id, key, label, Icon }) => (
          <IconButton
            key={id}
            size="md"
            className="h-control-lg w-control-lg"
            active={tool === id}
            label={label}
            tooltip={`${label} (${key})`}
            icon={<Icon />}
            onClick={() => setTool(id)}
          />
        ))}
      </div>
    </div>
  );
}
