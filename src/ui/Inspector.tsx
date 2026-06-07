import type { DocumentStore, EditorState } from "../document/store";
import { removeShape, reorderShape, updateShape } from "../document/docOps";
import { getShapeType } from "../field/registry";
import type { CombineOp } from "../field/combine";
import type { ParamSpec, ShapeInstance } from "../field/types";

function ParamControl(props: {
  name: string;
  spec: ParamSpec;
  value: number | string | boolean;
  onChange: (v: number | string) => void;
}): React.JSX.Element {
  const { name, spec, value, onChange } = props;
  if (spec.type === "enum") {
    return (
      <label className="flex items-center justify-between gap-2 py-1">
        <span className="text-fg-mid">{name}</span>
        <select
          className="rounded border border-panel-edge bg-canvasbg px-1 py-0.5"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {spec.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="text-fg-mid">{name}</span>
      <input
        type="number"
        className="w-24 rounded border border-panel-edge bg-canvasbg px-1 py-0.5 text-right"
        value={Number(value)}
        min={spec.min}
        max={spec.max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Inspector(props: { store: DocumentStore; state: EditorState }): React.JSX.Element {
  const { store, state } = props;
  const shape = state.doc.shapes.find((s) => s.id === state.selectedId);
  if (!shape) return <div className="text-fg-mid">No selection</div>;
  const type = getShapeType(shape.typeId);
  const patch = (fn: (s: ShapeInstance) => ShapeInstance): void => {
    store.update((d) => updateShape(d, shape.id, fn));
    store.endGesture();
  };
  const btn = "flex-1 rounded border border-panel-edge px-2 py-1 hover:border-accent";
  return (
    <div>
      <div className="mb-1 font-semibold">{type.name}</div>
      {Object.entries(type.params).map(([key, spec]) => (
        <ParamControl
          key={key}
          name={key}
          spec={spec}
          value={shape.params[key]!}
          onChange={(v) => patch((s) => ({ ...s, params: { ...s.params, [key]: v } }))}
        />
      ))}
      <div className="mt-2 border-t border-panel-edge pt-2">
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-fg-mid">combine</span>
          <select
            className="rounded border border-panel-edge bg-canvasbg px-1 py-0.5"
            value={shape.combine.op}
            onChange={(e) => patch((s) => ({ ...s, combine: { ...s.combine, op: e.target.value as CombineOp } }))}
          >
            <option value="raise">raise</option>
            <option value="add">add</option>
            <option value="carve">carve</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-fg-mid">blend</span>
          <input
            type="number"
            min={0}
            className="w-24 rounded border border-panel-edge bg-canvasbg px-1 py-0.5 text-right"
            value={shape.combine.blend}
            onChange={(e) =>
              patch((s) => ({ ...s, combine: { ...s.combine, blend: Math.max(0, Number(e.target.value)) } }))
            }
          />
        </label>
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-fg-mid">strength</span>
          <input
            type="number"
            step={0.1}
            className="w-24 rounded border border-panel-edge bg-canvasbg px-1 py-0.5 text-right"
            value={shape.strength}
            onChange={(e) => patch((s) => ({ ...s, strength: Number(e.target.value) }))}
          />
        </label>
        <div className="mt-2 flex gap-1">
          <button
            className={btn}
            onClick={() => {
              store.update((d) => reorderShape(d, shape.id, -1));
              store.endGesture();
            }}
          >
            Back
          </button>
          <button
            className={btn}
            onClick={() => {
              store.update((d) => reorderShape(d, shape.id, +1));
              store.endGesture();
            }}
          >
            Front
          </button>
          <button
            className="flex-1 rounded border border-panel-edge px-2 py-1 text-red-300 hover:border-red-400"
            onClick={() => {
              store.update((d) => removeShape(d, shape.id));
              store.endGesture();
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
