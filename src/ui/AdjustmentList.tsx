import { DismissRegular, EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { FormToggle, IconButton, Select, SpinSlider, humanizeLabel } from "@carapace/shell";
import { ADJUSTMENT_KINDS, adjustmentKind, adjustmentParam, createAdjustment, type AdjustmentDefaults } from "../field/adjustments";
import { updateObject } from "../document/docOps";
import type { DocumentStore } from "../document/store";
import type { Adjustment, ObjectInstance } from "../field/types";
import { cx } from "./kit";

/**
 * The Adjustments section of an adjustment layer's inspector: one row per transform (strength +
 * its params, bypass, delete) and an add picker. Applied in list order, top first — the same
 * order the fold runs them.
 */
export function AdjustmentList(props: {
  store: DocumentStore;
  nodeId: string;
  adjustments: Adjustment[];
  /** Project default params (project.lambert) — what inheriting entries show and apply. */
  defaults?: AdjustmentDefaults;
}): React.JSX.Element {
  const { store, nodeId, adjustments, defaults } = props;
  const patch = (fn: (list: Adjustment[]) => Adjustment[], coalesce?: string): void => {
    store.update((d) => updateObject(d, nodeId, (s: ObjectInstance) => ({ ...s, adjustments: fn(s.adjustments ?? []) })), coalesce ? { coalesce: `${coalesce}:${nodeId}` } : undefined);
    if (!coalesce) store.endGesture();
  };
  const patchOne = (id: string, fn: (a: Adjustment) => Adjustment, coalesce?: string): void =>
    patch((list) => list.map((a) => (a.id === id ? fn(a) : a)), coalesce);

  return (
    <div className="px-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wide text-fg-mid">Adjustments</span>
        <Select
          className="w-36"
          ariaLabel="Add adjustment"
          value=""
          options={[
            { value: "", label: "+ Add…" },
            ...ADJUSTMENT_KINDS.map((k) => ({ value: k.id, label: k.name })),
          ]}
          onChange={(v) => {
            if (v) patch((list) => [...list, createAdjustment(v)]);
          }}
        />
      </div>
      {adjustments.length === 0 ? (
        <p className="text-sm text-fg-mid">No adjustments. Add one to transform the height of every layer below this one, inside the region.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {adjustments.map((a) => {
            const kind = adjustmentKind(a.kind);
            const visible = a.visible !== false;
            const overridden = a.params !== undefined;
            return (
              <div key={a.id} className={cx("border border-border p-1.5", !visible && "opacity-50")}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex-1 truncate text-base text-fg">{kind?.name ?? a.kind}</span>
                  <IconButton
                    tooltip
                    label={visible ? "Bypass this adjustment" : "Enable this adjustment"}
                    icon={visible ? <EyeRegular /> : <EyeOffRegular />}
                    onClick={() => patchOne(a.id, (x) => ({ ...x, visible: visible ? false : undefined }))}
                  />
                  <IconButton
                    tooltip
                    variant="danger"
                    label="Delete adjustment"
                    icon={<DismissRegular />}
                    onClick={() => patch((list) => list.filter((x) => x.id !== a.id))}
                  />
                </div>
                <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1">
                  {/* off = follow the project's Adjustment Defaults LIVE; on = keep own values in the .lmb */}
                  <span className="text-sm text-fg-mid">override</span>
                  <div className="justify-self-start">
                    <FormToggle
                      ariaLabel="Override project defaults"
                      value={overridden}
                      onChange={(on) =>
                        patchOne(a.id, (x) => {
                          if (on) {
                            const params = kind
                              ? Object.fromEntries(Object.keys(kind.params).map((k) => [k, adjustmentParam(x, kind, defaults, k)]))
                              : {};
                            return { ...x, params };
                          }
                          const { params: _drop, ...rest } = x;
                          return rest;
                        })
                      }
                    />
                  </div>
                  <span className="text-sm text-fg-mid">blend</span>
                  <SpinSlider
                    value={Math.round(a.strength * 100)}
                    min={0}
                    max={100}
                    integer
                    step={5}
                    suffix="%"
                    onChange={(v) => patchOne(a.id, (x) => ({ ...x, strength: Math.min(100, Math.max(0, v)) / 100 }), "adj-strength")}
                    onCommit={() => store.endGesture()}
                  />
                  {kind
                    ? Object.entries(kind.params).map(([key, spec]) => (
                        <>
                          <span key={`${a.id}:${key}:l`} className="text-sm text-fg-mid">
                            {humanizeLabel(key).toLowerCase()}
                          </span>
                          <div key={`${a.id}:${key}`} className={cx(!overridden && "pointer-events-none opacity-60")}>
                            <SpinSlider
                              value={adjustmentParam(a, kind, defaults, key)}
                              min={spec.min}
                              max={spec.max}
                              integer={!spec.float}
                              hideSlider={spec.min === undefined || spec.max === undefined}
                              readOnly={!overridden}
                              onChange={(v) => patchOne(a.id, (x) => ({ ...x, params: { ...x.params, [key]: v } }), `adj-${key}`)}
                              onCommit={() => store.endGesture()}
                            />
                          </div>
                        </>
                      ))
                    : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
