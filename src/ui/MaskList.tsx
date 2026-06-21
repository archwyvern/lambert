import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import type { Mask } from "../field/types";
import { Button, cx } from "./kit";

/** The Masks section shared by the shape and group inspectors: a "+ Add Mask" header (enters the pen
 *  tool) and one row per mask (keep/cut mode, follow toggle, visibility, delete). The owner wires the
 *  callbacks to its own node (a shape via updateShape, a group via updateNode). */
export function MaskList(props: {
  masks: Mask[];
  emptyHint: string;
  onAdd: () => void;
  onMode: (id: string, mode: "keep" | "cut") => void;
  onFollow: (id: string, follow: boolean) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const { masks, emptyHint, onAdd, onMode, onFollow, onToggleVisible, onRemove } = props;
  return (
    <div className="px-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-[var(--tracking-tight)] text-fg-mid">Masks</span>
        <Button onClick={onAdd}>+ Add Mask</Button>
      </div>
      {masks.length === 0 ? (
        <p className="text-sm text-fg-mid">{emptyHint}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {masks.map((m, i) => {
            const visible = m.visible !== false;
            return (
              <div key={m.id} className={cx("flex items-center gap-1.5 text-sm", !visible && "opacity-50")}>
                <span className="w-8 shrink-0 text-fg-mid">#{i + 1}</span>
                <select
                  className="border border-border bg-surface px-1 py-0.5 text-fg"
                  value={m.mode}
                  onChange={(e) => onMode(m.id, e.target.value as "keep" | "cut")}
                >
                  <option value="keep">keep</option>
                  <option value="cut">cut</option>
                </select>
                <label className="flex items-center gap-1 text-fg-mid">
                  <input type="checkbox" checked={m.follow} onChange={(e) => onFollow(m.id, e.target.checked)} />
                  follow
                </label>
                <button
                  title={visible ? "Hide mask (stops trimming)" : "Show mask"}
                  className="ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center text-fg-mid hover:text-fg"
                  onClick={() => onToggleVisible(m.id, !visible)}
                >
                  {visible ? <EyeRegular style={{ fontSize: 14 }} /> : <EyeOffRegular style={{ fontSize: 14 }} />}
                </button>
                <Button variant="danger" onClick={() => onRemove(m.id)}>
                  ×
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
