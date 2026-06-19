import type { DocumentStore, EditorState } from "../document/store";
import type { NormalDirs } from "../document/schema";
import { removeShape, reorderShape, updateShape } from "../document/docOps";
import { polygonStats, regularPolygon, regularPolygonAligned, resamplePolyline, ringPhase } from "../field/controlPoints";
import { canConvertToMesh, convertToMesh } from "../field/meshConvert";
import { getShapeType } from "../field/registry";
import { snapShapeToGrid } from "../field/snap";
import type { ShapeInstance } from "../field/types";
import { v2 } from "../field/vec";
import { Inspector as PropertyInspector } from "@carapace/shell";
import type { InspectorField, InspectorSectionInfo } from "@carapace/shell";
import { Vector3 } from "@carapace/primitives";
import { Button, humanizeLabel } from "./kit";

const toDeg = (rad: number): number => Number(((rad * 180) / Math.PI).toFixed(1));
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const SCALE_MIN = 0.05; // no negative/mirrored/zero scale
const SCRUB = 0.5; // gentler drag-scrub than carapace's default — most fields here are unbounded

const SECTIONS: InspectorSectionInfo[] = [{ name: "Parameters" }, { name: "Transform" }];

/** Number field with lambert's gentler drag-scrub; integer unless a sub-1 step says otherwise. */
const num = (
  f: Omit<Extract<InspectorField, { kind: "number" }>, "kind" | "dragScale"> & { dragScale?: number },
): InspectorField => ({ kind: "number", dragScale: SCRUB, integer: (f.step ?? 1) >= 1, ...f });

/** Vector field (carapace's per-axis SpinSliders), same scrub + integer conventions as `num`. */
const vec = (
  f: Omit<Extract<InspectorField, { kind: "vec" }>, "kind" | "dragScale"> & { dragScale?: number },
): InspectorField => ({ kind: "vec", dragScale: SCRUB, integer: (f.step ?? 1) >= 1, ...f });

export function Inspector(props: {
  store: DocumentStore;
  state: EditorState;
  selVerts: number[];
  /** Project-level normal-channel convention (project.lambert), shared by every image. */
  normalDirs: NormalDirs;
  onNormalDirs: (dirs: NormalDirs) => void;
}): React.JSX.Element {
  const { store, state, selVerts, normalDirs, onNormalDirs } = props;
  const shape = state.doc.shapes.find((s) => s.id === state.selectedId);

  if (!shape) {
    const doc = state.doc;
    const setDirs = (patch: Partial<NormalDirs>): void => onNormalDirs({ ...normalDirs, ...patch });
    const fields: InspectorField[] = [
      {
        kind: "enum",
        key: "red",
        label: "red",
        group: "Normal Directions",
        value: normalDirs.red === "left" ? 1 : 0,
        options: ["right", "left"],
        onChange: (i) => setDirs({ red: i === 1 ? "left" : "right" }),
      },
      {
        kind: "enum",
        key: "green",
        label: "green",
        group: "Normal Directions",
        value: normalDirs.green === "down" ? 1 : 0,
        options: ["up", "down"],
        onChange: (i) => setDirs({ green: i === 1 ? "down" : "up" }),
      },
    ];
    return (
      <div>
        <div className="mb-2 border-b border-border pb-1.5 text-md font-semibold text-fg">Document</div>
        <p className="mb-2 px-2 text-sm text-fg-mid">
          {doc.source.path} · {doc.source.width}×{doc.source.height}
        </p>
        <PropertyInspector fields={fields} sections={[{ name: "Normal Directions" }]} />
        <p className="mt-2 px-2 text-sm leading-snug text-fg-mid">
          Project-wide; applies to exports and the normal view. Select a shape to edit its parameters.
        </p>
      </div>
    );
  }

  const type = getShapeType(shape.typeId);
  const live = (fn: (s: ShapeInstance) => ShapeInstance, key: string): void =>
    store.update((d) => updateShape(d, shape.id, fn), { coalesce: `${key}:${shape.id}` });
  const commit = (): void => store.endGesture();

  const fields: InspectorField[] = [];

  // vertex count: ring shapes split into outer/inner; other control-point shapes get a single count
  if (type.controlPoints.kind === "rings") {
    fields.push(
      num({
        key: "outer",
        label: "outer vertices",
        group: "Parameters",
        value: shape.ringSplit ?? (shape.controlPoints.length >> 1),
        min: type.controlPoints.min ?? 3,
        max: 16,
        onChange: (v) => {
          const n = Math.round(v);
          if (n === (shape.ringSplit ?? (shape.controlPoints.length >> 1))) return;
          live((s) => {
            const split = s.ringSplit ?? (s.controlPoints.length >> 1);
            const base = polygonStats(s.controlPoints.slice(0, split));
            const top = s.controlPoints.slice(split);
            // phase-lock the new outer ring to the inner ring so base[i] stays over top[i]
            const ring = regularPolygonAligned(base.centroid, base.radius, n, ringPhase(top));
            const next = { ...s, controlPoints: [...ring, ...top], ringSplit: n };
            return s.gridSnap ? snapShapeToGrid(next) : next;
          }, "verts-outer");
        },
        onCommit: commit,
      }),
      num({
        key: "inner",
        label: "inner vertices",
        group: "Parameters",
        value: shape.controlPoints.length - (shape.ringSplit ?? (shape.controlPoints.length >> 1)),
        min: 1,
        max: 16,
        onChange: (v) => {
          const n = Math.round(v);
          const split = shape.ringSplit ?? (shape.controlPoints.length >> 1);
          if (n === shape.controlPoints.length - split) return;
          live((s) => {
            const sp = s.ringSplit ?? (s.controlPoints.length >> 1);
            const base = s.controlPoints.slice(0, sp);
            const top = polygonStats(s.controlPoints.slice(sp));
            // phase-lock the new inner ring to the outer ring so base[i] stays over top[i]
            const ring = regularPolygonAligned(top.centroid, top.radius, n, ringPhase(base));
            const next = { ...s, controlPoints: [...base, ...ring], ringSplit: sp };
            return s.gridSnap ? snapShapeToGrid(next) : next;
          }, "verts-inner");
        },
        onCommit: commit,
      }),
    );
  } else if (type.controlPoints.kind !== "none" && type.controlPoints.kind !== "mesh") {
    fields.push(
      num({
        key: "vertices",
        label: "vertices",
        group: "Parameters",
        value: shape.controlPoints.length,
        min: type.controlPoints.min ?? (type.controlPoints.kind === "polyline" ? 2 : 3),
        max: 16,
        onChange: (v) => {
          const n = Math.round(v);
          if (n === shape.controlPoints.length) return;
          live((s) => {
            if (type.controlPoints.kind === "polygon") {
              const { centroid, radius } = polygonStats(s.controlPoints);
              return { ...s, controlPoints: regularPolygon(centroid, radius, n) };
            }
            return { ...s, controlPoints: resamplePolyline(s.controlPoints, n) };
          }, "verts");
        },
        onCommit: commit,
      }),
    );
  }

  // shape parameters
  for (const [key, spec] of Object.entries(type.params)) {
    if (spec.type === "enum") {
      fields.push({
        kind: "enum",
        key,
        label: humanizeLabel(key),
        group: "Parameters",
        value: spec.options.indexOf(String(shape.params[key])),
        options: [...spec.options],
        onChange: (i) => {
          const v = spec.options[i]!;
          live((s) => ({ ...s, params: { ...s.params, [key]: v } }), `param-${key}`);
          commit();
        },
      });
    } else {
      fields.push(
        num({
          key,
          label: humanizeLabel(key),
          group: "Parameters",
          value: Number(shape.params[key]),
          min: spec.min,
          max: spec.max,
          step: spec.step,
          onChange: (v) => live((s) => ({ ...s, params: { ...s.params, [key]: v } }), `param-${key}`),
          onCommit: commit,
        }),
      );
    }
  }

  if (type.controlPoints.kind !== "none") {
    fields.push({
      kind: "bool",
      key: "gridsnap",
      label: "grid snap (½px)",
      group: "Parameters",
      value: shape.gridSnap ?? false,
      onChange: (on) => {
        store.update((d) =>
          updateShape(d, shape.id, (s) => (on ? { ...snapShapeToGrid(s), gridSnap: true } : { ...s, gridSnap: false })),
        );
        commit();
      },
    });
  }

  // transform: editing mesh vertices targets the vertex position (Z is mesh-only); else the shape's transform
  const meshVerts = shape.mesh && selVerts.length > 0;
  if (shape.mesh && selVerts.length > 0) {
    if (selVerts.length === 1) {
      const cp = shape.controlPoints[selVerts[0]!];
      fields.push(
        vec({
          key: "vpos",
          label: "position",
          group: "Transform",
          value: [cp?.x ?? 0, cp?.y ?? 0],
          size: 2,
          step: shape.gridSnap ? 0.5 : 1,
          onChange: (a) =>
            live(
              (s) => ({ ...s, controlPoints: s.controlPoints.map((p, i) => (i === selVerts[0] ? v2(a[0]!, a[1]!) : p)) }),
              "vpos",
            ),
          onCommit: commit,
        }),
      );
    }
    fields.push(
      num({
        key: "vz",
        label: "z",
        group: "Transform",
        value: Number((shape.mesh.z[selVerts[0]!] ?? 0).toFixed(1)),
        step: 1,
        onChange: (v) =>
          live(
            (s) => ({
              ...s,
              mesh: s.mesh ? { ...s.mesh, z: s.mesh.z.map((z, i) => (selVerts.includes(i) ? v : z)) } : s.mesh,
            }),
            "vz",
          ),
        onCommit: commit,
      }),
    );
  } else {
    const { pos, scale } = shape.transform;
    fields.push(
      vec({
        key: "tpos",
        label: "position",
        group: "Transform",
        value: [pos.x, pos.y, pos.z],
        size: 3,
        step: shape.gridSnap ? 0.5 : 1,
        onChange: (a) =>
          live((s) => ({ ...s, transform: { ...s.transform, pos: new Vector3(a[0]!, a[1]!, a[2]!) } }), "tpos"),
        onCommit: commit,
      }),
      num({
        key: "trot",
        label: "rotation",
        group: "Transform",
        value: toDeg(shape.transform.rotation),
        step: 5,
        onChange: (v) => live((s) => ({ ...s, transform: { ...s.transform, rotation: toRad(v) } }), "trot"),
        onCommit: commit,
      }),
      vec({
        key: "tscale",
        label: "scale",
        group: "Transform",
        value: [scale.x, scale.y, scale.z],
        size: 3,
        step: 0.1,
        min: SCALE_MIN,
        onChange: (a) =>
          live((s) => ({ ...s, transform: { ...s.transform, scale: new Vector3(a[0]!, a[1]!, a[2]!) } }), "tscale"),
        onCommit: commit,
      }),
    );
  }

  return (
    <div>
      <div className="mb-2 border-b border-border pb-1.5 text-md font-semibold text-fg">{type.name}</div>
      <PropertyInspector fields={fields} sections={SECTIONS} />
      {meshVerts ? (
        <p className="mt-1 px-2 text-sm leading-snug text-fg-mid">
          {selVerts.length === 1 ? "1 vertex" : `${selVerts.length} vertices`} · right-click a vertex or edge for actions
        </p>
      ) : null}
      {canConvertToMesh(shape) ? (
        <>
          <div className="my-3 border-t border-border" />
          <div className="px-2">
            <Button
              className="w-full"
              onClick={() => {
                const m = convertToMesh(shape);
                store.update((d) => ({ ...d, shapes: d.shapes.map((s) => (s.id === shape.id ? m : s)) }));
                commit();
                store.select(m.id);
              }}
            >
              Convert to Mesh
            </Button>
          </div>
        </>
      ) : null}
      <div className="my-3 border-t border-border" />
      <div className="flex gap-1 px-2">
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
