import type { DocumentStore, EditorState } from "../document/store";
import type { NormalDirs } from "../document/schema";
import { removeObject, reorderObject, updateObject } from "../document/docOps";
import { findNode, findParentId, updateNode } from "../document/layerOps";
import { isGroup, isObject } from "../field/types";
import { polygonStats, regularPolygon, regularPolygonAligned, resamplePolyline, ringPhase } from "../field/controlPoints";
import { setMaskFollow } from "../field/maskOps";
import { getObjectType, ObjectTypeId } from "../field/registry";
import { snapObjectToGrid } from "../field/snap";
import type { ObjectInstance } from "../field/types";
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
const SCALE_MIN = 0; // 0 and negative are both valid — scrub continuously through zero to flip/mirror an axis

/** Clamp a scale component to >= SCALE_MIN in magnitude, KEEPING its sign so a flip (negative scale)
 *  survives scrubbing. Zero -> +min. */
const clampScale = (v: number): number => (Math.abs(v) < SCALE_MIN ? (v < 0 ? -SCALE_MIN : SCALE_MIN) : v);

/** Group mirror modes; index order doubles as the enum-field option index. */
const MIRROR_MODES = ["none", "x", "y", "quad"] as const;

// SpinSlider's scrub step is universal in carapace now (float 0.01 / Shift 0.1 / Ctrl 1.0; integer = 1.0),
// so these helpers only tag the field kind. Genuinely-integer fields pass `integer: true`.
/** Number field. */
const num = (f: Omit<Extract<InspectorField, { kind: "number" }>, "kind">): InspectorField => ({ kind: "number", ...f });

/** Vector field (carapace's per-axis SpinSliders). */
const vec = (f: Omit<Extract<InspectorField, { kind: "vec" }>, "kind">): InspectorField => ({ kind: "vec", ...f });

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
  const object = selNode && isObject(selNode) ? selNode : undefined;
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
        key: `gscale:${gid}`, // per-object key so the ephemeral link state resets on reselect
        label: "scale",
        group: "Transform",
        value: [g.transform.scale.x, g.transform.scale.y, g.transform.scale.z],
        size: 3,
        link: true,
        onChange: (a) =>
          liveG(
            (n) => ({ ...n, transform: { ...n.transform, scale: new Vector3(clampScale(a[0]!), clampScale(a[1]!), clampScale(a[2]!)) } }),
            "gscale",
          ),
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
        <div className="mt-1 flex gap-1 px-2">
          <Button className="flex-1" onClick={() => { liveG((n) => ({ ...n, transform: { ...n.transform, scale: n.transform.scale.withX(-n.transform.scale.x) } }), "flip"); commitG(); }}>
            Flip H
          </Button>
          <Button className="flex-1" onClick={() => { liveG((n) => ({ ...n, transform: { ...n.transform, scale: n.transform.scale.withY(-n.transform.scale.y) } }), "flip"); commitG(); }}>
            Flip V
          </Button>
        </div>
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
          onToggleAA={(id, aa) => patchGMasks((n) => ({ ...n, masks: n.masks?.map((mm) => (mm.id === id ? { ...mm, hard: !aa } : mm)) }))}
          onToggleVisible={(id, visible) => patchGMasks((n) => ({ ...n, masks: n.masks?.map((mm) => (mm.id === id ? { ...mm, visible } : mm)) }))}
          onRemove={(id) => patchGMasks((n) => ({ ...n, masks: n.masks?.filter((mm) => mm.id !== id) }))}
        />
        <div className="my-3 border-t border-border" />
        <div className="flex gap-1 px-2">
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              store.update((d) => removeObject(d, gid));
              commitG();
            }}
          >
            Delete Group
          </Button>
        </div>
      </div>
    );
  }

  if (!object) {
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
          Project-wide; applies to exports and the normal view. Select an object to edit its parameters.
        </p>
      </div>
    );
  }

  const type = getObjectType(object.typeId);
  const live = (fn: (s: ObjectInstance) => ObjectInstance, key: string): void =>
    store.update((d) => updateObject(d, object.id, fn), { coalesce: `${key}:${object.id}` });
  const commit = (): void => store.endGesture();

  const fields: InspectorField[] = [];

  // vertex count: ring objects split into outer/inner; other control-point objects get a single count.
  // Bézier-bearing objects (baked-fill vectors) edit the path with the pen, so no vertex-count field.
  if (object.bezier) {
    // pen-edited: no polygon/ring vertex-count field
  } else if (type.controlPoints.kind === "rings") {
    fields.push(
      num({
        key: "outer",
        label: "outer vertices",
        group: "Parameters",
        value: object.ringSplit ?? (object.controlPoints.length >> 1),
        min: type.controlPoints.min ?? 3,
        max: 16,
        integer: true,
        onChange: (v) => {
          const n = Math.round(v);
          if (n === (object.ringSplit ?? (object.controlPoints.length >> 1))) return;
          live((s) => {
            const split = s.ringSplit ?? (s.controlPoints.length >> 1);
            const base = polygonStats(s.controlPoints.slice(0, split));
            const top = s.controlPoints.slice(split);
            // phase-lock the new outer ring to the inner ring so base[i] stays over top[i]
            const ring = regularPolygonAligned(base.centroid, base.radius, n, ringPhase(top));
            const next = { ...s, controlPoints: [...ring, ...top], ringSplit: n };
            return snap ? snapObjectToGrid(next) : next;
          }, "verts-outer");
        },
        onCommit: commit,
      }),
      num({
        key: "inner",
        label: "inner vertices",
        group: "Parameters",
        value: object.controlPoints.length - (object.ringSplit ?? (object.controlPoints.length >> 1)),
        min: 1,
        max: 16,
        integer: true,
        onChange: (v) => {
          const n = Math.round(v);
          const split = object.ringSplit ?? (object.controlPoints.length >> 1);
          if (n === object.controlPoints.length - split) return;
          live((s) => {
            const sp = s.ringSplit ?? (s.controlPoints.length >> 1);
            const base = s.controlPoints.slice(0, sp);
            const top = polygonStats(s.controlPoints.slice(sp));
            // phase-lock the new inner ring to the outer ring so base[i] stays over top[i]
            const ring = regularPolygonAligned(top.centroid, top.radius, n, ringPhase(base));
            const next = { ...s, controlPoints: [...base, ...ring], ringSplit: sp };
            return snap ? snapObjectToGrid(next) : next;
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
        value: object.controlPoints.length,
        min: type.controlPoints.min ?? (type.controlPoints.kind === "polyline" ? 2 : 3),
        max: 16,
        integer: true,
        onChange: (v) => {
          const n = Math.round(v);
          if (n === object.controlPoints.length) return;
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

  // object parameters
  const hasTilt = "tiltX" in type.params && "tiltY" in type.params;
  for (const [key, spec] of Object.entries(type.params)) {
    if (hasTilt && (key === "tiltX" || key === "tiltY")) continue; // shown via the TiltPad, not scrubbers
    if (key === "radius2") continue; // folded into the linked radius/radius2 vec
    if (key === "radius" && "radius2" in type.params) {
      // the two end radii of a Pipe bar: a linked vec2 (chain locks them = a uniform tube; unlink to taper)
      fields.push(
        vec({
          key: `radii:${object.id}`, // per-object key so the ephemeral link state resets on reselect
          label: "radii",
          group: "Parameters",
          layout: "rows", // radius / radius2 each as their own label|value row (aligned), chain spans them
          value: [Number(object.params.radius), Number(object.params.radius2)],
          size: 2,
          min: 0, // 0 is valid: radius2 = 0 tapers the end to a point (a cone)
          labels: ["radius", "radius2"],
          link: true,
          defaultLinked: true,
          onChange: (a) => live((s) => ({ ...s, params: { ...s.params, radius: a[0]!, radius2: a[1]! } }), "radii"),
          onCommit: commit,
        }),
      );
      continue;
    }
    if (spec.type === "enum") {
      fields.push({
        kind: "enum",
        key,
        label: humanizeLabel(key),
        group: "Parameters",
        value: spec.options.indexOf(String(object.params[key])),
        options: [...spec.options],
        onChange: (i) => {
          const v = spec.options[i]!;
          live((s) => ({ ...s, params: { ...s.params, [key]: v } }), `param-${key}`);
          commit();
        },
      });
    } else {
      // The Pipe bar grows from its +x (front) end: editing length pins the -x (back) end in place by
      // shifting the centre forward along the local x axis by scale.x * delta/2.
      const anchorsLength = key === "length" && object.typeId === ObjectTypeId.Pipe;
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
          value: Number(object.params[key]),
          min: spec.min,
          max: spec.max,
          // float params: 0.01 / Shift 0.1 (the universal scrub); non-float params stay integer.
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
        value: [Number(object.params.tiltX ?? 0), Number(object.params.tiltY ?? 0)],
        size: 2,
        min: -1,
        max: 1,
        onChange: (a) => live((s) => ({ ...s, params: { ...s.params, tiltX: a[0]!, tiltY: a[1]! } }), "tilt"),
        onCommit: commit,
      }),
    );
  }

  // the object's own transform — ALWAYS shown (selected vertices get their own section below, they
  // don't hijack the Transform fields)
  {
    const { pos, scale } = object.transform;
    // top-level positions display relative to the origin (pixel - origin); nested stay parent-relative
    const o = state.doc.canvas.origin;
    const topLevel = findParentId(state.doc.layers, object.id) === null;
    const dx = topLevel ? o.x : 0;
    const dy = topLevel ? o.y : 0;
    fields.push(
      vec({
        key: "tpos",
        label: "position",
        group: "Transform",
        value: [pos.x - dx, pos.y - dy, pos.z],
        size: 3,
        onChange: (a) =>
          live((s) => ({ ...s, transform: { ...s.transform, pos: new Vector3(a[0]! + dx, a[1]! + dy, a[2]!) } }), "tpos"),
        onCommit: commit,
      }),
      num({
        key: "trot",
        label: "rotation",
        group: "Transform",
        value: toDeg(object.transform.rotation),
        onChange: (v) => live((s) => ({ ...s, transform: { ...s.transform, rotation: toRad(wrapDeg(v)) } }), "trot"),
        onCommit: commit,
      }),
      vec({
        key: `tscale:${object.id}`, // per-object key so the ephemeral link state resets on reselect
        label: "scale",
        group: "Transform",
        value: [scale.x, scale.y, scale.z],
        size: 3,
        link: true,
        onChange: (a) =>
          live(
            (s) => ({ ...s, transform: { ...s.transform, scale: new Vector3(clampScale(a[0]!), clampScale(a[1]!), clampScale(a[2]!)) } }),
            "tscale",
          ),
        onCommit: commit,
      }),
    );
  }

  // selected control-point vertices get their OWN "Vertex" section. A single MESH vertex is one
  // Vector3 (x, y, height — z is the vertex height); a single non-mesh vertex is x/y; a multi-mesh
  // selection shows just height, applied to every selected vertex so a whole ridge raises at once.
  const editVerts = selVerts.length > 0 && object.controlPoints.length > 0;
  if (editVerts) {
    const i0 = selVerts[0]!;
    const cp = object.controlPoints[i0];
    if (selVerts.length === 1 && object.mesh) {
      fields.push(
        vec({
          key: "vpos3",
          label: "position",
          group: "Vertex",
          value: [cp?.x ?? 0, cp?.y ?? 0, object.mesh.z[i0] ?? 0],
          size: 3,
          onChange: (a) =>
            live(
              (s) => ({
                ...s,
                controlPoints: s.controlPoints.map((p, i) => (i === i0 ? v2(a[0]!, a[1]!) : p)),
                mesh: s.mesh ? { ...s.mesh, z: s.mesh.z.map((z, i) => (i === i0 ? a[2]! : z)) } : s.mesh,
              }),
              "vpos3",
            ),
          onCommit: commit,
        }),
      );
    } else if (selVerts.length === 1) {
      fields.push(
        vec({
          key: "vpos",
          label: "position",
          group: "Vertex",
          value: [cp?.x ?? 0, cp?.y ?? 0],
          size: 2,
          onChange: (a) =>
            live((s) => ({ ...s, controlPoints: s.controlPoints.map((p, i) => (i === i0 ? v2(a[0]!, a[1]!) : p)) }), "vpos"),
          onCommit: commit,
        }),
      );
    } else if (object.mesh) {
      fields.push(
        num({
          key: "vz",
          label: "height",
          group: "Vertex",
          value: Number((object.mesh.z[i0] ?? 0).toFixed(2)),
          onChange: (v) =>
            live(
              (s) => ({ ...s, mesh: s.mesh ? { ...s.mesh, z: s.mesh.z.map((z, i) => (selVerts.includes(i) ? v : z)) } : s.mesh }),
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
      <div className="mt-1 flex gap-1 px-2">
        <Button
          className="flex-1"
          onClick={() => {
            live((s) => ({ ...s, transform: { ...s.transform, scale: s.transform.scale.withX(-s.transform.scale.x) } }), "flip");
            commit();
          }}
        >
          Flip H
        </Button>
        <Button
          className="flex-1"
          onClick={() => {
            live((s) => ({ ...s, transform: { ...s.transform, scale: s.transform.scale.withY(-s.transform.scale.y) } }), "flip");
            commit();
          }}
        >
          Flip V
        </Button>
      </div>
      {editVerts ? (
        <p className="mt-1 px-2 text-sm leading-snug text-fg-mid">
          {selVerts.length === 1 ? "1 vertex" : `${selVerts.length} vertices`} · right-click or Alt-click an edge to insert · ⌫ deletes
        </p>
      ) : null}
      <div className="my-3 border-t border-border" />
      <MaskList
        masks={object.masks ?? []}
        emptyHint="No masks. Add one to trim this layer."
        onAdd={() => {
          store.select(object.id);
          setTool("pen");
        }}
        onMode={(id, mode) => {
          store.update((d) => updateObject(d, object.id, (s) => ({ ...s, masks: s.masks?.map((mm) => (mm.id === id ? { ...mm, mode } : mm)) })));
          commit();
        }}
        onFollow={(id, follow) => {
          store.update((d) => updateObject(d, object.id, (s) => setMaskFollow(s, id, follow)));
          commit();
        }}
        onToggleAA={(id, aa) => {
          store.update((d) => updateObject(d, object.id, (s) => ({ ...s, masks: s.masks?.map((mm) => (mm.id === id ? { ...mm, hard: !aa } : mm)) })));
          commit();
        }}
        onToggleVisible={(id, visible) => {
          store.update((d) => updateObject(d, object.id, (s) => ({ ...s, masks: s.masks?.map((mm) => (mm.id === id ? { ...mm, visible } : mm)) })));
          commit();
        }}
        onRemove={(id) => {
          store.update((d) => updateObject(d, object.id, (s) => ({ ...s, masks: s.masks?.filter((mm) => mm.id !== id) })));
          commit();
        }}
      />
      <div className="my-3 border-t border-border" />
      <div className="flex gap-1 px-2">
        <Button
          className="flex-1"
          onClick={() => {
            store.update((d) => reorderObject(d, object.id, -1));
            commit();
          }}
        >
          Back
        </Button>
        <Button
          className="flex-1"
          onClick={() => {
            store.update((d) => reorderObject(d, object.id, +1));
            commit();
          }}
        >
          Front
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          onClick={() => {
            store.update((d) => removeObject(d, object.id));
            commit();
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
