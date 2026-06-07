import type { DocumentStore, EditorState } from "../document/store";
import { removeShape, reorderShape, updateShape } from "../document/docOps";
import { polygonStats, regularPolygon, resamplePolyline } from "../field/controlPoints";
import { getShapeType } from "../field/registry";
import type { ShapeInstance } from "../field/types";
import { Button, humanizeLabel, SectionLabel, SelectRow, SpinBox } from "./kit";

const toDeg = (rad: number): number => Number(((rad * 180) / Math.PI).toFixed(1));
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const safeScale = (v: number): number => Math.sign(v || 1) * Math.max(0.05, Math.abs(v));

export function Inspector(props: { store: DocumentStore; state: EditorState }): React.JSX.Element {
  const { store, state } = props;
  const shape = state.doc.shapes.find((s) => s.id === state.selectedId);
  if (!shape) {
    const doc = state.doc;
    const setDirs = (patch: Partial<typeof doc.normalDirs>): void => {
      store.update((d) => ({ ...d, normalDirs: { ...d.normalDirs, ...patch } }));
      store.endGesture();
    };
    return (
      <div>
        <SectionLabel>Document</SectionLabel>
        <p className="mb-2 text-sm text-fg-mid">
          {doc.source.path} · {doc.source.width}×{doc.source.height}
        </p>
        <SectionLabel>Normal Directions</SectionLabel>
        <SelectRow
          label="red"
          value={doc.normalDirs.red}
          options={["right", "left"]}
          onChange={(v) => setDirs({ red: v as "right" | "left" })}
        />
        <SelectRow
          label="green"
          value={doc.normalDirs.green}
          options={["up", "down"]}
          onChange={(v) => setDirs({ green: v as "up" | "down" })}
        />
        <p className="mt-2 text-sm leading-snug text-fg-mid">
          Applies to exports and the normal view. Select a shape to edit its parameters.
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
      <div className="mb-2 border-b border-border pb-1.5 text-md font-semibold text-fg">{type.name}</div>
      <SectionLabel>Parameters</SectionLabel>
      {type.controlPoints.kind !== "none" ? (
        <SpinBox
          label="vertices"
          value={shape.controlPoints.length}
          min={type.controlPoints.min ?? (type.controlPoints.kind === "polygon" ? 3 : 2)}
          max={16}
          onChange={(v) => {
            const n = Math.round(v);
            if (n === shape.controlPoints.length) return;
            live((s) => {
              if (type.controlPoints.kind === "polygon") {
                const { centroid, radius } = polygonStats(s.controlPoints);
                return { ...s, controlPoints: regularPolygon(centroid, radius, n) };
              }
              return { ...s, controlPoints: resamplePolyline(s.controlPoints, n) };
            }, "verts");
          }}
          onCommit={commit}
        />
      ) : null}
      {Object.entries(type.params).map(([key, spec]) =>
        spec.type === "enum" ? (
          <SelectRow
            key={key}
            label={humanizeLabel(key)}
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
            label={humanizeLabel(key)}
            value={Number(shape.params[key])}
            min={spec.min}
            max={spec.max}
            onChange={(v) => live((s) => ({ ...s, params: { ...s.params, [key]: v } }), `param-${key}`)}
            onCommit={commit}
          />
        ),
      )}
      <div className="my-3 border-t border-border" />
      <SectionLabel>Transform</SectionLabel>
      <SpinBox
        label="x"
        value={Number(shape.transform.pos.x.toFixed(1))}
        onChange={(v) =>
          live((s) => ({ ...s, transform: { ...s.transform, pos: { ...s.transform.pos, x: v } } }), "tx")
        }
        onCommit={commit}
      />
      <SpinBox
        label="y"
        value={Number(shape.transform.pos.y.toFixed(1))}
        onChange={(v) =>
          live((s) => ({ ...s, transform: { ...s.transform, pos: { ...s.transform.pos, y: v } } }), "ty")
        }
        onCommit={commit}
      />
      <SpinBox
        label="rotation"
        value={toDeg(shape.transform.rotation)}
        step={5}
        onChange={(v) => live((s) => ({ ...s, transform: { ...s.transform, rotation: toRad(v) } }), "trot")}
        onCommit={commit}
      />
      <SpinBox
        label="scale x"
        value={Number(shape.transform.scale.x.toFixed(2))}
        step={0.1}
        onChange={(v) =>
          live(
            (s) => ({ ...s, transform: { ...s.transform, scale: { ...s.transform.scale, x: safeScale(v) } } }),
            "tsx",
          )
        }
        onCommit={commit}
      />
      <SpinBox
        label="scale y"
        value={Number(shape.transform.scale.y.toFixed(2))}
        step={0.1}
        onChange={(v) =>
          live(
            (s) => ({ ...s, transform: { ...s.transform, scale: { ...s.transform.scale, y: safeScale(v) } } }),
            "tsy",
          )
        }
        onCommit={commit}
      />
      <SpinBox
        label="scale z"
        value={Number(shape.transform.scale.z.toFixed(2))}
        step={0.1}
        onChange={(v) =>
          live(
            (s) => ({ ...s, transform: { ...s.transform, scale: { ...s.transform.scale, z: safeScale(v) } } }),
            "tsz",
          )
        }
        onCommit={commit}
      />
      <div className="my-3 border-t border-border" />
      <SectionLabel>Compositing</SectionLabel>
      <SpinBox
        label="blend"
        value={shape.combine.blend}
        min={0}
        onChange={(v) => live((s) => ({ ...s, combine: { ...s.combine, blend: v } }), "blend")}
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
