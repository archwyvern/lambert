import type { DocumentStore, EditorState } from "../document/store";
import { removeShape, reorderShape, updateShape } from "../document/docOps";
import { polygonStats, regularPolygon, regularPolygonAligned, resamplePolyline, ringPhase } from "../field/controlPoints";
import { canConvertToMesh, convertToMesh } from "../field/meshConvert";
import { getShapeType } from "../field/registry";
import { snapShapeToGrid } from "../field/snap";
import type { ShapeInstance } from "../field/types";
import { v2 } from "../field/vec";
import { Button, humanizeLabel, SectionLabel, SelectRow, SpinBox, ToggleRow } from "./kit";

const toDeg = (rad: number): number => Number(((rad * 180) / Math.PI).toFixed(1));
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const safeScale = (v: number): number => Math.max(0.05, v); // no negative/mirrored scale

export function Inspector(props: {
  store: DocumentStore;
  state: EditorState;
  selVerts: number[];
}): React.JSX.Element {
  const { store, state, selVerts } = props;
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
      {(type.controlPoints.kind !== "none" && type.controlPoints.kind !== "mesh") ||
      Object.keys(type.params).length > 0 ? (
        <SectionLabel>Parameters</SectionLabel>
      ) : null}
      {type.controlPoints.kind === "rings" ? (
        <>
          <SpinBox
            label="outer vertices"
            value={shape.ringSplit ?? (shape.controlPoints.length >> 1)}
            min={type.controlPoints.min ?? 3}
            max={16}
            onChange={(v) => {
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
            }}
            onCommit={commit}
          />
          <SpinBox
            label="inner vertices"
            value={shape.controlPoints.length - (shape.ringSplit ?? (shape.controlPoints.length >> 1))}
            min={1}
            max={16}
            onChange={(v) => {
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
            }}
            onCommit={commit}
          />
        </>
      ) : type.controlPoints.kind !== "none" && type.controlPoints.kind !== "mesh" ? (
        <SpinBox
          label="vertices"
          value={shape.controlPoints.length}
          min={type.controlPoints.min ?? (type.controlPoints.kind === "polyline" ? 2 : 3)}
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
            step={spec.step}
            onChange={(v) => live((s) => ({ ...s, params: { ...s.params, [key]: v } }), `param-${key}`)}
            onCommit={commit}
          />
        ),
      )}
      {type.controlPoints.kind !== "none" ? (
        <ToggleRow
          label="grid snap (½px)"
          checked={shape.gridSnap ?? false}
          title="Snap this shape's vertices and position to the ½-pixel grid"
          onChange={(on) => {
            store.update((d) =>
              updateShape(d, shape.id, (s) =>
                on ? { ...snapShapeToGrid(s), gridSnap: true } : { ...s, gridSnap: false },
              ),
            );
            commit();
          }}
        />
      ) : null}
      <div className="my-3 border-t border-border" />
      <SectionLabel>Transform</SectionLabel>
      {shape.mesh && selVerts.length > 0 ? (
        // editing mesh vertices: the transform IS the vertex's position (Z is mesh-only)
        <>
          {selVerts.length === 1 ? (
            <>
              <SpinBox
                label="x"
                value={Number((shape.controlPoints[selVerts[0]!]?.x ?? 0).toFixed(1))}
                step={shape.gridSnap ? 0.5 : 1}
                onChange={(v) =>
                  live(
                    (s) => ({ ...s, controlPoints: s.controlPoints.map((p, i) => (i === selVerts[0] ? v2(v, p.y) : p)) }),
                    "vx",
                  )
                }
                onCommit={commit}
              />
              <SpinBox
                label="y"
                value={Number((shape.controlPoints[selVerts[0]!]?.y ?? 0).toFixed(1))}
                step={shape.gridSnap ? 0.5 : 1}
                onChange={(v) =>
                  live(
                    (s) => ({ ...s, controlPoints: s.controlPoints.map((p, i) => (i === selVerts[0] ? v2(p.x, v) : p)) }),
                    "vy",
                  )
                }
                onCommit={commit}
              />
            </>
          ) : null}
          <SpinBox
            label="z"
            value={Number((shape.mesh.z[selVerts[0]!] ?? 0).toFixed(1))}
            step={1}
            onChange={(v) =>
              live(
                (s) => ({
                  ...s,
                  mesh: s.mesh ? { ...s.mesh, z: s.mesh.z.map((z, i) => (selVerts.includes(i) ? v : z)) } : s.mesh,
                }),
                "vz",
              )
            }
            onCommit={commit}
          />
          <p className="mt-1 text-sm leading-snug text-fg-mid">
            {selVerts.length === 1 ? "1 vertex" : `${selVerts.length} vertices`} · right-click a vertex or edge for actions
          </p>
        </>
      ) : (
        <>
          <SpinBox
            label="x"
            value={Number(shape.transform.pos.x.toFixed(1))}
            step={shape.gridSnap ? 0.5 : 1}
            onChange={(v) =>
              live((s) => ({ ...s, transform: { ...s.transform, pos: { ...s.transform.pos, x: v } } }), "tx")
            }
            onCommit={commit}
          />
          <SpinBox
            label="y"
            value={Number(shape.transform.pos.y.toFixed(1))}
            step={shape.gridSnap ? 0.5 : 1}
            onChange={(v) =>
              live((s) => ({ ...s, transform: { ...s.transform, pos: { ...s.transform.pos, y: v } } }), "ty")
            }
            onCommit={commit}
          />
          <SpinBox
            label="z"
            value={Number(shape.transform.pos.z.toFixed(1))}
            step={shape.gridSnap ? 0.5 : 1}
            onChange={(v) =>
              live((s) => ({ ...s, transform: { ...s.transform, pos: { ...s.transform.pos, z: v } } }), "tz")
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
        </>
      )}
      {canConvertToMesh(shape) ? (
        <>
          <div className="my-3 border-t border-border" />
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
        </>
      ) : null}
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
