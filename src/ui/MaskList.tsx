import { BlurRegular, DismissRegular, EyeOffRegular, EyeRegular, LinkDismissRegular, LinkRegular } from "@fluentui/react-icons";
import { IconButton, Select } from "@carapace/shell";
import type { Mask } from "../field/types";
import { Button, cx } from "./kit";

/** The Masks section shared by the object and group inspectors: a "+ Add Mask" header (enters the pen
 *  tool) and one row per mask (keep/cut mode, follow toggle, visibility, delete). The owner wires the
 *  callbacks to its own node (an object via updateObject, a group via updateNode). */
export function MaskList(props: {
  masks: Mask[];
  emptyHint: string;
  onAdd: () => void;
  /** Click on the mask's number: select it (all anchors) in the editor. */
  onSelect: (id: string) => void;
  onMode: (id: string, mode: "keep" | "cut") => void;
  onFollow: (id: string, follow: boolean) => void;
  onToggleAA: (id: string, aa: boolean) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const { masks, emptyHint, onAdd, onSelect, onMode, onFollow, onToggleAA, onToggleVisible, onRemove } = props;
  return (
    <div className="px-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wide text-fg-mid">Masks</span>
        <Button onClick={onAdd}>+ Add Mask</Button>
      </div>
      {masks.length === 0 ? (
        <p className="text-sm text-fg-mid">{emptyHint}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {masks.map((m, i) => {
            const visible = m.visible !== false;
            return (
              <div key={m.id} className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", !visible && "opacity-50")}>
                <button
                  className="w-6 shrink-0 text-left text-fg-mid hover:text-accent"
                  title="Select this mask in the editor"
                  onClick={() => onSelect(m.id)}
                >
                  #{i + 1}
                </button>
                <Select
                  className="w-16"
                  ariaLabel="Mask mode"
                  value={m.mode}
                  options={[
                    { value: "keep", label: "keep" },
                    { value: "cut", label: "cut" },
                  ]}
                  onChange={(v) => onMode(m.id, v as "keep" | "cut")}
                />
                <IconButton
                  tooltip
                  active={m.follow}
                  label={m.follow ? "Following the object transform — click to pin to world" : "Pinned to world — click to follow the object"}
                  icon={m.follow ? <LinkRegular /> : <LinkDismissRegular />}
                  onClick={() => onFollow(m.id, !m.follow)}
                />
                <IconButton
                  tooltip
                  active={m.hard !== true}
                  label={m.hard !== true ? "Anti-aliased edge — click for a hard edge" : "Hard edge — click for anti-aliasing"}
                  icon={<BlurRegular />}
                  onClick={() => onToggleAA(m.id, m.hard === true)}
                />
                <IconButton
                  tooltip
                  className="ml-auto"
                  label={visible ? "Hide mask (stops trimming)" : "Show mask"}
                  icon={visible ? <EyeRegular /> : <EyeOffRegular />}
                  onClick={() => onToggleVisible(m.id, !visible)}
                />
                <IconButton tooltip variant="danger" label="Delete mask" icon={<DismissRegular />} onClick={() => onRemove(m.id)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
