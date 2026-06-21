import {
  ArrowExpandRegular,
  ArrowMoveRegular,
  ArrowRotateClockwiseRegular,
  BezierCurveSquareRegular,
  CursorRegular,
  PenRegular,
} from "@fluentui/react-icons";
import { cx } from "./kit";
import type { ToolMode } from "./tools";

const ICON = { fontSize: 16 } as const;

/** The canvas tools as a 2-column vertical palette, docked to the right of the left sidebar.
 *  Keyboard shortcuts (QWERT) are owned by App's keydown handler, not these buttons. */
const TOOLS: Array<{ id: ToolMode; key: string; label: string; Icon: typeof CursorRegular }> = [
  { id: "select", key: "Q", label: "Select", Icon: CursorRegular },
  { id: "move", key: "W", label: "Move", Icon: ArrowMoveRegular },
  { id: "rotate", key: "E", label: "Rotate", Icon: ArrowRotateClockwiseRegular },
  { id: "scale", key: "R", label: "Scale", Icon: ArrowExpandRegular },
  { id: "vertex", key: "T", label: "Edit Vertices", Icon: BezierCurveSquareRegular },
  { id: "pen", key: "P", label: "Mask Pen", Icon: PenRegular },
];

export function ToolPalette(props: { tool: ToolMode; setTool: (t: ToolMode) => void }): React.JSX.Element {
  const { tool, setTool } = props;
  return (
    <div className="shrink-0 bg-bg p-2">
      <div className="grid grid-cols-2 gap-1">
        {TOOLS.map(({ id, key, label, Icon }) => (
          <button
            key={id}
            title={`${label} (${key})`}
            onClick={() => setTool(id)}
            className={cx(
              "flex h-[30px] w-[30px] items-center justify-center border",
              tool === id
                ? "border-accent bg-list-active text-fg"
                : "border-border text-fg-mid hover:bg-hover hover:text-fg",
            )}
          >
            <Icon style={ICON} />
          </button>
        ))}
      </div>
    </div>
  );
}
