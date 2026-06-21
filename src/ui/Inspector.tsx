import type { DocumentStore, EditorState } from "../document/store";
import type { NormalDirs } from "../document/schema";
import { removeShape, reorderShape, updateShape } from "../document/docOps";
import { findNode, findParentId, updateNode } from "../document/layerOps";
import { isGroup, isShape } from "../field/types";
import { polygonStats, regularPolygon, regularPolygonAligned, resamplePolyline, ringPhase } from "../field/controlPoints";
import { setMaskFollow } from "../field/maskOps";
import { getShapeType } from "../field/registry";
import { snapShapeToGrid } from "../field/snap";
import type { ShapeInstance } from "../field/types";
import { v2 } from "../field/vec";
import { Inspector as PropertyInspector } from "@carapace/shell";
import type { InspectorField, InspectorSectionInfo } from "@carapace/shell";
import { Vector3 } from "@carapace/primitives";
import { Button, humanizeLabel } from "./kit";
import { MaskList } from "./MaskList";
import type { ToolMode } from "./tools";

const toDeg = (rad: number): number => Number(((rad * 180) / Math.PI).toFixed(1));
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const wrapDeg = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180; // -> (-180, 180]
const SCALE_MIN = 0.05; // no negative/mirrored/zero scale
const SCRUB = 0.5; // gentler drag-scrub than carapace's default — most fields here are unbounded
const SHIFT_FAST = 10; // hold Shift to scrub 10x faster (carapace's default Shift is 10x *finer*)

/** Group mirror modes; index order doubles as the enum-field option index. */
const MIRROR_MODES = ["none", "x", "y", "quad"] as const;

// Every numeric field is floating-point by default: step 0.01 (so drag-scrub = 0.01/px, and Shift =
// 0.1/px via SHIFT_FAST). Genuinely-integer fields (vertex counts) opt out with `integer: true, step: 1`.
/** Number field — float 0.01 / Shift 0.1 by default. */
const num = (
  f: Omit<Extract<InspectorField, { kind: "number" }>, "kind" | "dragScale"> & { dragScale?: number },
): InspectorField => ({ kind: "number", dragScale: SCRUB, shiftScale: SHIFT_FAST, step: 0.01, ...f });

/** Vector field (carapace's per-axis SpinSliders), same float-0.01 conventions as `num`. */
const vec = (
  f: Omit<Extract<InspectorField, { kind: "vec" }>, "kind" | "dragScale"> & { dragScale?: number },
): InspectorField => ({ kind: "vec", dragScale: SCRUB, shiftScale: SHIFT_FAST, step: 0.01, ...f });

export function Inspector(props: {
  store: DocumentStore;
  state: EditorState;
  selVerts: number[];
  /** Project-level normal-channel convention (project.lambert), shared by every image. */
  normalDirs: NormalDirs;
  onNormalDirs: (dirs: NormalDirs) => void;
  /** Switch the active canvas tool (the Masks "+ Add" button enters the pen tool). */
  setTool: (t: ToolMode) => void;
  /** Global ½px grid snap (drives ring-regen snap + spinbox step granularity). */
  snap: boolean;
}): React.JSX.Element {
  const { store, state, selVerts, normalDirs, onNormalDirs, setTool, snap } = props;
  const selNode = state.selectedId ? findNode(state.doc.layers, state.selectedId) : null;
  const shape = selNode && isShape(selNode) ? selNode : undefined;
  // when several layers are selected we edit the PRIMARY (last picked) and show a count banner
  const multiBanner =
    state.selectedIds.length > 1 ? (
      <p className="mb-2 bg-list-active px-2 py-1 text-sm text-fg">
        {state.selectedIds.length} layers selected · editing the last; canvas drag moves all
      </p>
    ) : null;

  if (selNode && isGroup(selNode)) {
    const g = selNode;
    const gid = g.id;
    const commitG = (): void => store.endGesture();
    const liveG = (fn: (n: typeof g) => typeof g, key: string): void =>
      store.update((d) => ({ ...d, layers: updateNode(d.layers, gid, (n) => (isGroup(n) ? fn(n) : n)) }), { coalesce: `${key}:${gid}` });
    // top-level group position displays relative to the origin
    const go = state.doc.canvas.origin;
    const gtop = findParentId(state.doc.layers, gid) === null;
    const gdx = gtop ? go.x : 0;
    const gdy = gtop ? go.y : 0;
    const gfields: InspectorField[] = [
      vec({
        key: "gpos",
        label: "position",
        group: "Transform",
        value: [g.transform.pos.x - gdx, g.transform.pos.y - gdy, g.transform.pos.z],
        size: 3,
        step: snap ? 0.5 : 0.01,
        onChange: (a) => liveG((n) => ({ ...n, transform: { ...n.transform, pos: new Vector3(a[0]! + gdx, a[1]! + gdy, a[2]!) } }), "gpos"),
        onCommit: commitG,
      }),
      num({
        key: "grot",
        label: "rotation",
        group: "Transform",
        value: toDeg(g.transform.rotation),
        onChange: (v) => liveG((n) => ({ ...n, transform: { ...n.transform, rotation: toRad(wrapDeg(v)) } }), "grot"),
        onCommit: commitG,
      }),
      vec({
        key: "gscale",
        label: "scale",
        group: "Transform",
        value: [g.transform.scale.x, g.transform.scale.y, g.transform.scale.z],
        size: 3,
        min: SCALE_MIN,
        onChange: (a) => liveG((n) => ({ ...n, transform: { ...n.transform, scale: new Vector3(a[0]!, a[1]!, a[2]!) } }), "gscale"),
        onCommit: commitG,
      }),
      {
        kind: "enum",
        key: "mirror",
        label: "mirror",
        group: "Symmetry",
        value: MIRROR_MODES.indexOf(g.mirror ?? "none"),
        options: [...MIRROR_MODES],
        onChange: (i) => {
          liveG((n) => ({ ...n, mirror: MIRROR_MODES[i] }), "mirror");
          commitG();
        },
      },
    ];
    // mutate the group's masks (group-scope trims) via updateNode + endGesture
    const patchGMasks = (fn: (n: typeof g) => typeof g): void => {
      store.update((d) => ({ ...d, layers: updateNode(d.layers, gid, (n) => (isGroup(n) ? fn(n) : n)) }));
      commitG();
    };
    return (
      <div>
        {multiBanner}
        <div className="mb-2 border-b border-border pb-1.5 text-md font-semibold text-fg">{g.name ?? "Group"}</div>
        <p className="mb-2 px-2 text-sm text-fg-mid">{g.children.length} layer{g.children.length === 1 ? "" : "s"}</p>
        <PropertyInspector fields={gfields} sections={[{ name: "Transform" }, { name: "Symmetry" }]} />
        <div className="my-3 border-t border-border" />
        <MaskList
          masks={g.masks ?? []}
          emptyHint="No masks. Add one to trim every layer in this group (and define a mirror's visible side)."
          onAdd={() => {
            store.select(gid);
            setTool("pen");
          }}
          onMode={(id, mode) => patchGMasks((n) => ({ ...n, masks: n.masks?.map((mm) => (mm.id === id ? { ...mm, mode } : mm)) }))}
          onFollow={(id, follow) => patchGMasks((n) => setMaskFollow(n, id, follow))}
          onToggleVisible={(id, visible) => patchGMasks((n) => ({ ...n, masks: n.masks?.map((mm) => (mm.id === id ? { ...mm, visible } : mm)) }))}
          onRemove={(id) => patchGMasks((n) => ({ ...n, masks: n.masks?.filter((mm) => mm.id !== id) }))}
        />
        <div className="my-3 border-t border-border" />
        <div className="flex gap-1 px-2">
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              store.update((d) => removeShape(d, gid));
              commitG();
            }}
          >
            Delete Group
          </Button>
        </div>
      </div>
    );
  }

  if (!shape) {
    const doc = state.doc;
    const setDirs = (patch: Partial<NormalDirs>): void => onNormalDirs({ ...normalDirs, ...patch });
    const setOrigin = (origin: { x: number; y: number }): void => {
      store.update((d) => ({ ...d, canvas: { ...d.canvas, origin } }));
      store.endGesture();
    };
    const fields: InspectorField[] = [
      vec({
        key: "origin",
        label: "origin",
        group: "Canvas",
        value: [doc.canvas.origin.x, doc.canvas.origin.y],
        size: 2,
        step: 1,
        onChange: (a) => store.update((d) => ({ ...d, canvas: { ...d.canvas, origin: { x: a[0]!, y: a[1]! } } }), { coalesce: "origin" }),
        onCommit: () => store.endGesture(),
      }),
      {
        kind: "bool",
        key: "guidesLocked",
        label: "guides locked",
        group: "Canvas",
        value: doc.canvas.guidesLocked,
        onChange: (v) => {
          store.update((d) => ({ ...d, canvas: { ...d.canvas, guidesLocked: v } }));
          store.endGesture();
        },
      },
      {
        kind: "bool",
        key: "snapToGuides",
        label: "snap to guides",
        group: "Canvas",
        value: doc.canvas.snapToGuides,
        onChange: (v) => {
          store.update((d) => ({ ...d, canvas: { ...d.canvas, snapToGuides: v } }));
          store.endGesture();
        },
      },
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
        <PropertyInspector fields={fields} sections={[{ name: "Canvas" }, { name: "Normal Directions" }]} />
        <div className="mt-1 mb-2 flex gap-1 px-2">
          <Button className="flex-1" onClick={() => setOrigin({ x: doc.source.width / 2, y: doc.source.height / 2 })}>
            Centre
          </Button>
          <Button className="flex-1" onClick={() => setOrigin({ x: doc.source.width / 2, y: 0 })}>
            Top Ctr
          </Button>
          <Button className="flex-1" onClick={() => setOrigin({ x: 0, y: 0 })}>
            Top Left
          </Button>
        </div>
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
        step: 1,
        integer: true,
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
            return snap ? snapShapeToGrid(next) : next;
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
        step: 1,
        integer: true,
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
            return snap ? snapShapeToGrid(next) : next;
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
        step: 1,
        integer: true,
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
  const hasTilt = "tiltX" in type.params && "tiltY" in type.params;
  for (const [key, spec] of Object.entries(type.params)) {
    if (hasTilt && (key === "tiltX" || key === "tiltY")) continue; // shown via the TiltPad, not scrubbers
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
      // The bars (cylinder/frustum) grow from their +x (front) end: editing length pins the -x (back)
      // end in place by shifting the centre forward along the local x axis by scale.x * delta/2.
      const anchorsLength = key === "length" && (shape.typeId === "cylinder" || shape.typeId === "frustum");
      const onChange = anchorsLength
        ? (v: number) =>
            live((s) => {
              const d = (v - Number(s.params.length ?? v)) / 2;
              const c = Math.cos(s.transform.rotation);
              const sn = Math.sin(s.transform.rotation);
              const sx = s.transform.scale.x;
              const pos = new Vector3(
                s.transform.pos.x + sx * d * c,
                s.transform.pos.y + sx * d * sn,
                s.transform.pos.z,
              );
              return { ...s, params: { ...s.params, length: v }, transform: { ...s.transform, pos } };
            }, `param-${key}`)
        : (v: number) => live((s) => ({ ...s, params: { ...s.params, [key]: v } }), `param-${key}`);
      fields.push(
        num({
          key,
          label: humanizeLabel(key),
          group: "Parameters",
          value: Number(shape.params[key]),
          min: spec.min,
          max: spec.max,
          // float params: 0.01 / Shift 0.1 (the universal scrub); non-float params stay integer.
          step: spec.float ? (spec.step ?? 0.01) : (spec.step ?? 1),
          integer: !spec.float,
          onChange,
          onCommit: commit,
        }),
      );
    }
  }

  // tilt: a single Vector2 field (the slope direction+steepness), driving the tiltX/tiltY params
  if (hasTilt) {
    fields.push(
      vec({
        key: "tilt",
        label: "tilt",
        group: "Parameters",
        value: [Number(shape.params.tiltX ?? 0), Number(shape.params.tiltY ?? 0)],
        size: 2,
        min: -1,
        max: 1,
        step: 0.01,
        onChange: (a) => live((s) => ({ ...s, params: { ...s.params, tiltX: a[0]!, tiltY: a[1]! } }), "tilt"),
        onCommit: commit,
      }),
    );
  }

  // the shape's own transform — ALWAYS shown (selected vertices get their own section below, they
  // don't hijack the Transform fields)
  {
    const { pos, scale } = shape.transform;
    // top-level positions display relative to the origin (pixel - origin); nested stay parent-relative
    const o = state.doc.canvas.origin;
    const topLevel = findParentId(state.doc.layers, shape.id) === null;
    const dx = topLevel ? o.x : 0;
    const dy = topLevel ? o.y : 0;
    fields.push(
      vec({
        key: "tpos",
        label: "position",
        group: "Transform",
        value: [pos.x - dx, pos.y - dy, pos.z],
        size: 3,
        step: snap ? 0.5 : 0.01,
        onChange: (a) =>
          live((s) => ({ ...s, transform: { ...s.transform, pos: new Vector3(a[0]! + dx, a[1]! + dy, a[2]!) } }), "tpos"),
        onCommit: commit,
      }),
      num({
        key: "trot",
        label: "rotation",
        group: "Transform",
        value: toDeg(shape.transform.rotation),
        onChange: (v) => live((s) => ({ ...s, transform: { ...s.transform, rotation: toRad(wrapDeg(v)) } }), "trot"),
        onCommit: commit,
      }),
      vec({
        key: "tscale",
        label: "scale",
        group: "Transform",
        value: [scale.x, scale.y, scale.z],
        size: 3,
        min: SCALE_MIN,
        onChange: (a) =>
          live((s) => ({ ...s, transform: { ...s.transform, scale: new Vector3(a[0]!, a[1]!, a[2]!) } }), "tscale"),
        onCommit: commit,
      }),
    );
  }

  // selected control-point vertices get their OWN "Vertex" section: a single vertex shows x/y (and,
  // for a mesh, its height); a multi-selection shows just height, applied to every selected vertex so
  // a whole ridge raises at once. (Multi x/y is the canvas drag.)
  const editVerts = selVerts.length > 0 && shape.controlPoints.length > 0;
  if (editVerts) {
    if (selVerts.length === 1) {
      const cp = shape.controlPoints[selVerts[0]!];
      fields.push(
        vec({
          key: "vpos",
          label: "position",
          group: "Vertex",
          value: [cp?.x ?? 0, cp?.y ?? 0],
          size: 2,
          step: snap ? 0.5 : 0.01,
          onChange: (a) =>
            live(
              (s) => ({ ...s, controlPoints: s.controlPoints.map((p, i) => (i === selVerts[0] ? v2(a[0]!, a[1]!) : p)) }),
              "vpos",
            ),
          onCommit: commit,
        }),
      );
    }
    if (shape.mesh) {
      fields.push(
        num({
          key: "vz",
          label: "height",
          group: "Vertex",
          value: Number((shape.mesh.z[selVerts[0]!] ?? 0).toFixed(2)),
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
    }
  }

  // sections shown in this order, omitting any with no fields (e.g. a multi-vertex non-mesh selection
  // contributes no Vertex fields). Vertex first so it leads when you're editing one.
  const sectionOrder = ["Vertex", "Parameters", "Transform"];
  const presentGroups = new Set(fields.map((f) => f.group));
  const sections: InspectorSectionInfo[] = sectionOrder.filter((g) => presentGroups.has(g)).map((name) => ({ name }));

  return (
    <div>
      {multiBanner}
      <div className="mb-2 border-b border-border pb-1.5 text-md font-semibold text-fg">{type.name}</div>
      <PropertyInspector fields={fields} sections={sections} />
      {editVerts ? (
        <p className="mt-1 px-2 text-sm leading-snug text-fg-mid">
          {selVerts.length === 1 ? "1 vertex" : `${selVerts.length} vertices`} · right-click or Alt-click an edge to insert · ⌫ deletes
        </p>
      ) : null}
      <div className="my-3 border-t border-border" />
      <MaskList
        masks={shape.masks ?? []}
        emptyHint="No masks. Add one to trim this layer."
        onAdd={() => {
          store.select(shape.id);
          setTool("pen");
        }}
        onMode={(id, mode) => {
          store.update((d) => updateShape(d, shape.id, (s) => ({ ...s, masks: s.masks?.map((mm) => (mm.id === id ? { ...mm, mode } : mm)) })));
          commit();
        }}
        onFollow={(id, follow) => {
          store.update((d) => updateShape(d, shape.id, (s) => setMaskFollow(s, id, follow)));
          commit();
        }}
        onToggleVisible={(id, visible) => {
          store.update((d) => updateShape(d, shape.id, (s) => ({ ...s, masks: s.masks?.map((mm) => (mm.id === id ? { ...mm, visible } : mm)) })));
          commit();
        }}
        onRemove={(id) => {
          store.update((d) => updateShape(d, shape.id, (s) => ({ ...s, masks: s.masks?.filter((mm) => mm.id !== id) })));
          commit();
        }}
      />
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
