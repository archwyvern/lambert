import { DismissRegular, EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { FormToggle, IconButton, Select } from "@carapace/shell";
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
  onToggleAA: (id: string, aa: boolean) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const { masks, emptyHint, onAdd, onMode, onFollow, onToggleAA, onToggleVisible, onRemove } = props;
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
              <div key={m.id} className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", !visible && "opacity-50")}>
                <span className="w-6 shrink-0 text-fg-mid">#{i + 1}</span>
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
                <span className="flex items-center gap-1 text-fg-mid">
                  follow
                  <FormToggle ariaLabel="Mask follows the shape transform" value={m.follow} onChange={(v) => onFollow(m.id, v)} />
                </span>
                <span className="flex items-center gap-1 text-fg-mid" title="Anti-alias the mask edge (off = hard edge)">
                  AA
                  <FormToggle ariaLabel="Anti-alias the mask edge" value={m.hard !== true} onChange={(v) => onToggleAA(m.id, v)} />
                </span>
                <IconButton
                  className="ml-auto"
                  label={visible ? "Hide mask (stops trimming)" : "Show mask"}
                  icon={visible ? <EyeRegular /> : <EyeOffRegular />}
                  onClick={() => onToggleVisible(m.id, !visible)}
                />
                <IconButton variant="danger" label="Delete mask" icon={<DismissRegular />} onClick={() => onRemove(m.id)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
