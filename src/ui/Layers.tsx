import {
  ChevronDownRegular,
  ChevronRightRegular,
  EyeOffRegular,
  EyeRegular,
  FlipHorizontalRegular,
  FolderRegular,
  LockClosedRegular,
  LockOpenRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { Vector3 } from "@carapace/primitives";
import type { DocumentStore, EditorState } from "../document/store";
import { duplicateObject, moveObjectTo, removeObject, updateObject } from "../document/docOps";
import { addGroup, emptyGroup, findNode, findParentId, moveNode, siblingsOf, ungroup, updateNode, wrapInGroup } from "../document/layerOps";
import { getObjectType, ObjectTypeId } from "../field/registry";
import { bakeToMesh, convertToVector, VECTOR_CONVERTIBLE } from "../field/convert";
import { isGroup, isObject, type GroupLayer, type LayerNode } from "../field/types";
import { Button, ContextMenu, cx, SectionLabel } from "./kit";
import { localBounds } from "./objectBounds";
import { OBJECT_ICONS } from "./objectIcons";

const DRAG_MIME = "application/x-lambert-layer";

interface Menu {
  x: number;
  y: number;
  id: string;
}

/** Display name for a node: its user name, else the group label / object type name. */
function nodeLabel(n: LayerNode): string {
  if (n.name) return n.name;
  return isGroup(n) ? "Group" : getObjectType(n.typeId).name;
}

/**
 * Layer tree panel: groups + objects, front-most on top, indented by depth. Click selects, drag
 * reparents/reorders, right-click for verbs (Group / Ungroup / Duplicate / reorder / Delete), eye =
 * visibility, lock = inert on canvas. Collapse a group via its chevron.
 */
export function Layers(props: { store: DocumentStore; state: EditorState }): React.JSX.Element {
  const { store, state } = props;
  const layers = state.doc.layers;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dropId, setDropId] = useState<string | null>(null); // row being hovered as a drop target

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  // F2 renames the selected layer from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "F2" || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const id = state.selectedId;
      const n = id ? findNode(state.doc.layers, id) : null;
      if (!n) return;
      e.preventDefault();
      setRenaming(n.id);
      setRenameText(nodeLabel(n));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.selectedId, state.doc.layers]);

  const patchNode = (id: string, fn: (n: LayerNode) => LayerNode): void => {
    store.update((d) => ({ ...d, layers: updateNode(d.layers, id, fn) }));
    store.endGesture();
  };

  const commitRename = (id: string): void => {
    const name = renameText.trim();
    patchNode(id, (n) => ({ ...n, name: name === "" ? undefined : name }) as LayerNode);
    setRenaming(null);
  };

  const doOp = (fn: (d: typeof state.doc) => typeof state.doc): void => {
    store.update(fn);
    store.endGesture();
  };

  // drop `dragged` onto `target`: into a group, else reorder just before the target in its parent
  const onDropOn = (targetId: string, draggedId: string): void => {
    if (draggedId === targetId) return;
    const target = findNode(layers, targetId);
    if (!target) return;
    if (isGroup(target)) {
      store.update((d) => ({ ...d, layers: moveNode(d.layers, draggedId, targetId, target.children.length) }));
    } else {
      const parent = findParentId(layers, targetId);
      const sibs = siblingsOf(layers, targetId);
      const idx = sibs.findIndex((n) => n.id === targetId);
      store.update((d) => ({ ...d, layers: moveNode(d.layers, draggedId, parent ?? null, idx) }));
    }
    store.endGesture();
    setDropId(null);
  };

  const menuNode = menu ? findNode(layers, menu.id) : null;
  // context-menu verbs act on the whole selection when the right-clicked row is one of its members
  const menuTargets = !menuNode
    ? []
    : state.selectedIds.includes(menuNode.id) && state.selectedIds.length > 1
      ? state.selectedIds
      : [menuNode.id];

  // click selection with modifiers: plain = one, Ctrl/Cmd = toggle, Shift = range over visible order
  const onRowClick = (e: React.MouseEvent, id: string): void => {
    if (e.metaKey || e.ctrlKey) {
      store.toggleSelect(id);
    } else if (e.shiftKey && state.selectedId) {
      const a = order.indexOf(state.selectedId);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        store.setSelection(order.slice(lo, hi + 1));
      } else {
        store.select(id);
      }
    } else {
      store.select(id);
    }
  };

  // render the tree depth-first, front-most (last in array) on top. `order` is the flat visible id
  // list in display order (top->bottom) for Shift-range selection.
  const rows: React.JSX.Element[] = [];
  const order: string[] = [];
  const walk = (nodes: LayerNode[], depth: number): void => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!;
      order.push(n.id);
      const selected = state.selectedIds.includes(n.id);
      const group = isGroup(n);
      rows.push(
        <div
          key={n.id}
          role="button"
          tabIndex={0}
          draggable={renaming !== n.id}
          onClick={(e) => onRowClick(e, n.id)}
          onDoubleClick={() => {
            setRenaming(n.id);
            setRenameText(nodeLabel(n));
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            // keep a multi-selection when right-clicking one of its members; else select just this row
            if (!state.selectedIds.includes(n.id)) store.select(n.id);
            setMenu({ x: e.clientX, y: e.clientY, id: n.id });
          }}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, n.id);
            e.dataTransfer.effectAllowed = "move";
            if (!state.selectedIds.includes(n.id)) store.select(n.id);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
            e.preventDefault();
            setDropId(n.id);
          }}
          onDragLeave={() => setDropId((d) => (d === n.id ? null : d))}
          onDrop={(e) => {
            const id = e.dataTransfer.getData(DRAG_MIME);
            if (!id) return;
            e.preventDefault();
            e.stopPropagation();
            onDropOn(n.id, id);
          }}
          className={cx(
            "group flex h-[24px] cursor-pointer items-center gap-1 px-1.5 text-base",
            selected ? "bg-list-active text-fg" : "text-fg-mid hover:bg-hover hover:text-fg",
            !n.visible && "opacity-50",
            dropId === n.id && "outline outline-1 outline-accent",
          )}
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          {group ? (
            <button
              className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-fg-mid hover:text-fg"
              title={n.collapsed ? "Expand" : "Collapse"}
              onClick={(e) => {
                e.stopPropagation();
                patchNode(n.id, (g) => ({ ...g, collapsed: !(g as { collapsed?: boolean }).collapsed }) as LayerNode);
              }}
            >
              {n.collapsed ? <ChevronRightRegular style={{ fontSize: 12 }} /> : <ChevronDownRegular style={{ fontSize: 12 }} />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {group ? (
            <FolderRegular className="h-4.5 w-4.5 shrink-0 text-fg-mid" />
          ) : OBJECT_ICONS[n.typeId] ? (
            <img src={OBJECT_ICONS[n.typeId]} alt="" className="h-4.5 w-4.5 shrink-0" draggable={false} />
          ) : (
            <span className="h-4.5 w-4.5 shrink-0" />
          )}
          {renaming === n.id ? (
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => commitRename(n.id)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitRename(n.id);
                if (e.key === "Escape") setRenaming(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-[18px] min-w-0 flex-1 border border-accent bg-surface2 px-1 text-base text-fg outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{nodeLabel(n)}</span>
          )}
          {isGroup(n) && n.mirror && n.mirror !== "none" ? (
            <button
              title={n.mirrorEnabled === false ? "Show mirror" : "Hide mirror"}
              className={cx(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center hover:text-fg",
                n.mirrorEnabled === false ? "text-fg-mid" : "text-accent",
              )}
              onClick={(e) => {
                e.stopPropagation();
                patchNode(n.id, (x) => ({ ...x, mirrorEnabled: (x as GroupLayer).mirrorEnabled === false }) as LayerNode);
              }}
            >
              <FlipHorizontalRegular style={{ fontSize: 13 }} />
            </button>
          ) : null}
          <button
            title={n.locked ? "Unlock" : "Lock (inert on canvas)"}
            className={cx(
              "flex h-[18px] w-[18px] shrink-0 items-center justify-center hover:text-fg",
              n.locked ? "text-accent" : "text-fg-mid",
            )}
            onClick={(e) => {
              e.stopPropagation();
              patchNode(n.id, (x) => ({ ...x, locked: !x.locked }) as LayerNode);
            }}
          >
            {n.locked ? <LockClosedRegular style={{ fontSize: 13 }} /> : <LockOpenRegular style={{ fontSize: 13 }} />}
          </button>
          <button
            title={n.visible ? "Hide" : "Show"}
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-fg-mid hover:text-fg"
            onClick={(e) => {
              e.stopPropagation();
              patchNode(n.id, (x) => ({ ...x, visible: !x.visible }) as LayerNode);
            }}
          >
            {n.visible ? <EyeRegular style={{ fontSize: 13 }} /> : <EyeOffRegular style={{ fontSize: 13 }} />}
          </button>
        </div>,
      );
      if (group && !n.collapsed) walk(n.children, depth + 1);
    }
  };
  walk(layers, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between">
        <SectionLabel>Layers</SectionLabel>
        <Button
          onClick={() => {
            const o = state.doc.canvas.origin;
            const g = emptyGroup(crypto.randomUUID());
            g.transform = { ...g.transform, pos: new Vector3(o.x, o.y, 0) }; // spawn at the origin
            store.update((d) => ({ ...d, layers: addGroup(d.layers, g) }));
            store.endGesture();
            store.select(g.id);
          }}
        >
          + Group
        </Button>
      </div>
      {layers.length === 0 ? (
        <p className="text-sm leading-snug text-fg-mid">No layers yet.</p>
      ) : (
        <div
          className="relative min-h-0 flex-1 overflow-y-auto"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
          }}
          onDrop={(e) => {
            // drop in empty space => move to top level (end = front)
            const id = e.dataTransfer.getData(DRAG_MIME);
            if (!id) return;
            store.update((d) => ({ ...d, layers: moveNode(d.layers, id, null, d.layers.length) }));
            store.endGesture();
            setDropId(null);
          }}
        >
          {rows}
        </div>
      )}
      {menu && menuNode ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(isGroup(menuNode)
              ? [
                  {
                    label: "Ungroup",
                    onClick: () =>
                      store.update((d) => {
                        const next = ungroup(d.layers, menuNode.id);
                        return next ? { ...d, layers: next } : d;
                      }),
                  },
                ]
              : [
                  {
                    label: menuTargets.length > 1 ? `Group ${menuTargets.length} Layers` : "Group",
                    onClick: () => {
                      const gid = crypto.randomUUID();
                      doOp((d) => ({ ...d, layers: wrapInGroup(d.layers, menuTargets, gid, d.canvas.origin) }));
                      store.select(gid);
                    },
                  },
                ]),
            {
              label: "Rename",
              hotkey: "F2",
              onClick: () => {
                setRenaming(menuNode.id);
                setRenameText(nodeLabel(menuNode));
              },
            },
            {
              label: "Duplicate",
              hotkey: "Ctrl+D",
              onClick: () => doOp((d) => menuTargets.reduce((acc, tid) => duplicateObject(acc, tid), d)),
            },
            ...(!isGroup(menuNode) && VECTOR_CONVERTIBLE.has(menuNode.typeId)
              ? [
                  {
                    // swap a primitive for its path-editable Bézier "(Vector)" twin
                    label: "Convert to Vector",
                    onClick: () =>
                      doOp((d) =>
                        menuTargets.reduce((acc, tid) => updateObject(acc, tid, (s) => (isObject(s) ? (convertToVector(s) ?? s) : s)), d),
                      ),
                  },
                ]
              : []),
            ...(!isGroup(menuNode) && menuNode.typeId !== ObjectTypeId.Mesh
              ? [
                  {
                    // bake the parametric/Bézier field to an editable triangle mesh (one-way)
                    label: "Convert to Mesh",
                    onClick: () =>
                      doOp((d) =>
                        menuTargets.reduce(
                          (acc, tid) =>
                            updateObject(acc, tid, (s) => (isObject(s) && s.typeId !== ObjectTypeId.Mesh ? bakeToMesh(s, localBounds(s)) : s)),
                          d,
                        ),
                      ),
                  },
                ]
              : []),
            "separator",
            { label: "Bring to Front", onClick: () => doOp((d) => moveObjectTo(d, menuNode.id, Number.MAX_SAFE_INTEGER)) },
            { label: "Send to Back", onClick: () => doOp((d) => moveObjectTo(d, menuNode.id, 0)) },
            "separator",
            {
              label: menuTargets.length > 1 ? `Delete ${menuTargets.length} Layers` : "Delete",
              danger: true,
              hotkey: "⌫",
              onClick: () => doOp((d) => menuTargets.reduce((acc, tid) => removeObject(acc, tid), d)),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
