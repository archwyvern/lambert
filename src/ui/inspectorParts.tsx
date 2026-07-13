import { Vector3 } from "@aphralatrax/primitives";
import type { InspectorField } from "@carapace/shell";
import type { LambertDoc } from "../document/schema";
import type { DocumentStore } from "../document/store";
import { nodeFrames } from "../document/layerOps";
import { setMaskFollow } from "../field/maskOps";
import type { Mask } from "../field/types";
import type { Transform2D } from "../field/transform";
import { MaskList } from "./MaskList";
import type { ToolMode } from "./tools";

// Shared Inspector building blocks (QC-CARRY-2): the object and group arms previously each hand-built
// the transform field trio, the flip buttons, and the MaskList plumbing — identical except for how the
// node is addressed in the doc. These take that addressing as a parameter.

const toDeg = (rad: number): number => Number(((rad * 180) / Math.PI).toFixed(1));
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const wrapDeg = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180; // -> (-180, 180]
const SCALE_MIN = 0; // 0 and negative are both valid — scrub continuously through zero to flip/mirror an axis

/** Clamp a scale component to >= SCALE_MIN in magnitude, KEEPING its sign so a flip (negative scale)
 *  survives the clamp. */
const clampScale = (v: number): number => (Math.abs(v) < SCALE_MIN ? (v < 0 ? -SCALE_MIN : SCALE_MIN) : v);

/** The position / rotation / scale field trio shared by the object and group Inspector arms.
 *  `live` applies a TRANSFORM-level patch (each arm adapts it onto its node); top-level nodes display
 *  position relative to the canvas origin via dx/dy. */
export function transformFields(opts: {
  /** Field-key prefix ("t" object / "g" group — keeps coalesce keys distinct per arm). */
  keyPrefix: string;
  /** Per-node suffix for the scale key so the ephemeral link state resets on reselect. */
  nodeId: string;
  transform: Transform2D;
  dx: number;
  dy: number;
  live: (patch: (t: Transform2D) => Transform2D, key: string) => void;
  commit: () => void;
}): InspectorField[] {
  const { keyPrefix: k, nodeId, transform, dx, dy, live, commit } = opts;
  return [
    {
      kind: "vec",
      key: `${k}pos`,
      label: "position",
      group: "Transform",
      value: [transform.pos.x - dx, transform.pos.y - dy, transform.pos.z],
      size: 3,
      onChange: (a) => live((t) => ({ ...t, pos: new Vector3(a[0]! + dx, a[1]! + dy, a[2]!) }), `${k}pos`),
      onCommit: commit,
    },
    {
      kind: "number",
      key: `${k}rot`,
      label: "rotation",
      group: "Transform",
      value: toDeg(transform.rotation),
      onChange: (v) => live((t) => ({ ...t, rotation: toRad(wrapDeg(v)) }), `${k}rot`),
      onCommit: commit,
    },
    {
      kind: "vec",
      key: `${k}scale:${nodeId}`,
      label: "scale",
      group: "Transform",
      value: [transform.scale.x, transform.scale.y, transform.scale.z],
      size: 3,
      link: true,
      onChange: (a) => live((t) => ({ ...t, scale: new Vector3(clampScale(a[0]!), clampScale(a[1]!), clampScale(a[2]!)) }), `${k}scale`),
      onCommit: commit,
    },
  ];
}

/**
 * MaskList wired to a doc node: all the standard verbs (mode / follow / AA / visibility / remove /
 * add-via-pen) against whichever node addressing the caller supplies — `updateNodeIn` is
 * updateObject for the object arm, updateNode+isGroup for the group arm. Follow conversions go
 * through the node's CURRENT world frames at update time.
 */
export function NodeMaskList<N extends { masks?: Mask[] }>(props: {
  store: DocumentStore;
  nodeId: string;
  masks: Mask[];
  emptyHint: string;
  setTool: (t: ToolMode) => void;
  onSelect: (maskId: string) => void;
  updateNodeIn: (d: LambertDoc, fn: (n: N) => N) => LambertDoc;
}): React.JSX.Element {
  const { store, nodeId, masks, emptyHint, setTool, onSelect, updateNodeIn } = props;
  const patch = (fn: (n: N) => N): void => store.commit((d) => updateNodeIn(d, fn));
  const mapMasks = (fn: (m: Mask) => Mask): void => patch((n) => ({ ...n, masks: n.masks?.map(fn) }));
  return (
    <MaskList
      masks={masks}
      emptyHint={emptyHint}
      onSelect={onSelect}
      onAdd={() => {
        store.select(nodeId);
        setTool("pen");
      }}
      onMode={(id, mode) => mapMasks((m) => (m.id === id ? { ...m, mode } : m))}
      onFollow={(id, follow) =>
        store.commit((d) => {
          const { worldAffine, invWorld } = nodeFrames(d.layers, nodeId);
          return updateNodeIn(d, (n) => setMaskFollow(n, id, follow, worldAffine, invWorld));
        })
      }
      onToggleAA={(id, aa) => mapMasks((m) => (m.id === id ? { ...m, hard: !aa } : m))}
      onToggleVisible={(id, visible) => mapMasks((m) => (m.id === id ? { ...m, visible } : m))}
      onRemove={(id) => patch((n) => ({ ...n, masks: n.masks?.filter((m) => m.id !== id) }))}
    />
  );
}
