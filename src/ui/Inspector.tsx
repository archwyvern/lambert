import type { DocumentStore, EditorState } from "../document/store";
import { removeShape, reorderShape, updateShape } from "../document/docOps";
import { getShapeType } from "../field/registry";
import type { CombineOp } from "../field/combine";
import type { ShapeInstance } from "../field/types";
import { Button, SectionLabel, SelectRow, SpinBox } from "./kit";

const COMBINE_OPS = ["raise", "add", "carve"] as const;

export function Inspector(props: { store: DocumentStore; state: EditorState }): React.JSX.Element {
  const { store, state } = props;
  const shape = state.doc.shapes.find((s) => s.id === state.selectedId);
  if (!shape) {
    return (
      <div>
        <SectionLabel>Inspector</SectionLabel>
        <p className="text-sm leading-snug text-fg-mid">
          Nothing selected. Click a shape on the canvas to edit its parameters.
        </p>
      </div>
    );
  }
  const type = getShapeType(shape.typeId);
  const live = (fn: (s: ShapeInstance) => ShapeInstance, key: string): void =>
    store.update((d) => updateShape(d, shape.id, fn), { coalesce: `${key}:${shape.id}` });
  const commit = (): void => store.endGesture();

  return (
    <div>
      <div className="mb-2 text-md font-semibold text-accent">{type.name}</div>
      {Object.entries(type.params).map(([key, spec]) =>
        spec.type === "enum" ? (
          <SelectRow
            key={key}
            label={key}
            value={String(shape.params[key])}
            options={spec.options}
            onChange={(v) => {
              live((s) => ({ ...s, params: { ...s.params, [key]: v } }), `param-${key}`);
              commit();
            }}
          />
        ) : (
          <SpinBox
            key={key}
            label={key}
            value={Number(shape.params[key])}
            min={spec.min}
            max={spec.max}
            onChange={(v) => live((s) => ({ ...s, params: { ...s.params, [key]: v } }), `param-${key}`)}
            onCommit={commit}
          />
        ),
      )}
      <div className="my-3 border-t border-border" />
      <SectionLabel>Compositing</SectionLabel>
      <SelectRow
        label="combine"
        value={shape.combine.op}
        options={COMBINE_OPS}
        onChange={(v) => {
          live((s) => ({ ...s, combine: { ...s.combine, op: v as CombineOp } }), "combine");
          commit();
        }}
      />
      <SpinBox
        label="blend"
        value={shape.combine.blend}
        min={0}
        onChange={(v) => live((s) => ({ ...s, combine: { ...s.combine, blend: v } }), "blend")}
        onCommit={commit}
      />
      <SpinBox
        label="strength"
        value={shape.strength}
        step={0.1}
        onChange={(v) => live((s) => ({ ...s, strength: v }), "strength")}
        onCommit={commit}
      />
      <div className="my-3 border-t border-border" />
      <div className="flex gap-1">
        <Button
          className="flex-1"
          onClick={() => {
            store.update((d) => reorderShape(d, shape.id, -1));
            commit();
          }}
        >
          Back
        </Button>
        <Button
          className="flex-1"
          onClick={() => {
            store.update((d) => reorderShape(d, shape.id, +1));
            commit();
          }}
        >
          Front
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          onClick={() => {
            store.update((d) => removeShape(d, shape.id));
            commit();
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
