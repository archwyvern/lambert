import { EyeOffRegular, EyeRegular, LockClosedRegular, LockOpenRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import type { DocumentStore, EditorState } from "../document/store";
import { duplicateShape, moveShapeTo, removeShape, updateShape } from "../document/docOps";
import { getShapeType } from "../field/registry";
import type { ShapeInstance } from "../field/types";
import { cx, SectionLabel } from "./kit";
import { SHAPE_ICONS } from "./shapeIcons";

/** Subtractive shapes (carve types) get a "-" marker; clipping shapes stay unmarked. */
const isCarve = (typeId: string): boolean => getShapeType(typeId).defaultCombine === "carve";

interface Menu {
  x: number;
  y: number;
  shapeId: string;
}

/**
 * Layer panel: every placed shape, front-most on top. Click selects (the only selection
 * surface for non-pointer tools), double-click renames, drag reorders, right-click for
 * the verb menu. Eye = visibility, lock = inert on canvas (inspector still edits).
 */
export function Layers(props: { store: DocumentStore; state: EditorState }): React.JSX.Element {
  const { store, state } = props;
  const shapes = state.doc.shapes;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  // drop gap in DISPLAY coordinates (0 = above the front-most row), null = no drag
  const [dropGap, setDropGap] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  // stable display names: occurrence count per type, in fold (array) order
  const counts = new Map<string, number>();
  const labels = shapes.map((s) => {
    if (s.name) return s.name;
    const n = (counts.get(s.typeId) ?? 0) + 1;
    counts.set(s.typeId, n);
    return n > 1 ? `${getShapeType(s.typeId).name} ${n}` : getShapeType(s.typeId).name;
  });

  const patch = (id: string, fn: (s: ShapeInstance) => ShapeInstance): void => {
    store.update((d) => updateShape(d, id, fn));
    store.endGesture();
  };

  const commitRename = (id: string): void => {
    const name = renameText.trim();
    patch(id, (s) => ({ ...s, name: name === "" ? undefined : name }));
    setRenaming(null);
  };

  /** Map a display gap to moveShapeTo's final array index. */
  const dropToIndex = (fromDisplay: number, gap: number): number => {
    const target = gap > fromDisplay ? gap - 1 : gap;
    return shapes.length - 1 - target;
  };

  const menuShape = menu ? shapes.find((s) => s.id === menu.shapeId) : null;
  const menuItem =
    "block w-full px-3 py-1 text-left text-base text-fg hover:bg-hover disabled:opacity-40";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SectionLabel>Layers</SectionLabel>
      {shapes.length === 0 ? (
        <p className="text-sm leading-snug text-fg-mid">No shapes yet.</p>
      ) : (
        <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto">
          {[...shapes.keys()].reverse().map((i, displayIndex) => {
            const s = shapes[i]!;
            const selected = s.id === state.selectedId;
            return (
              <div key={s.id} className="relative">
                {dropGap === displayIndex ? (
                  <div className="pointer-events-none absolute top-0 right-0 left-0 z-10 h-[2px] bg-accent" />
                ) : null}
                <div
                  role="button"
                  tabIndex={0}
                  draggable={renaming !== s.id}
                  onClick={() => store.select(s.id)}
                  onDoubleClick={() => {
                    setRenaming(s.id);
                    setRenameText(s.name ?? labels[i]!);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    store.select(s.id);
                    setMenu({ x: e.clientX, y: e.clientY, shapeId: s.id });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") store.select(s.id);
                    if (e.key === "F2") {
                      setRenaming(s.id);
                      setRenameText(s.name ?? labels[i]!);
                    }
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-lambert-layer", s.id);
                    e.dataTransfer.effectAllowed = "move";
                    store.select(s.id);
                  }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes("application/x-lambert-layer")) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const below = e.clientY > rect.top + rect.height / 2;
                    setDropGap(displayIndex + (below ? 1 : 0));
                  }}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData("application/x-lambert-layer");
                    if (!id || dropGap === null) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const fromDisplay = shapes.length - 1 - shapes.findIndex((sh) => sh.id === id);
                    store.update((d) => moveShapeTo(d, id, dropToIndex(fromDisplay, dropGap)));
                    store.endGesture();
                    setDropGap(null);
                  }}
                  onDragEnd={() => setDropGap(null)}
                  className={cx(
                    "group flex h-[24px] cursor-pointer items-center gap-1.5 px-1.5 text-base",
                    selected ? "bg-list-active text-fg" : "text-fg-mid hover:bg-hover hover:text-fg",
                    !s.visible && "opacity-50",
                  )}
                >
                  {SHAPE_ICONS[s.typeId] ? (
                    <img src={SHAPE_ICONS[s.typeId]} alt="" className="h-4.5 w-4.5 shrink-0" draggable={false} />
                  ) : (
                    <span className="h-4.5 w-4.5 shrink-0" />
                  )}
                  {renaming === s.id ? (
                    <input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => commitRename(s.id)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commitRename(s.id);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-[18px] min-w-0 flex-1 border border-accent bg-surface2 px-1 text-base text-fg outline-none"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{labels[i]}</span>
                  )}
                  {isCarve(s.typeId) ? (
                    <span className="w-2 shrink-0 text-center font-mono text-sm text-fg-mid" title="carves">
                      -
                    </span>
                  ) : null}
                  <button
                    title={s.locked ? "Unlock" : "Lock (inert on canvas)"}
                    className={cx(
                      "flex h-[18px] w-[18px] shrink-0 items-center justify-center hover:text-fg",
                      s.locked ? "text-accent" : "text-fg-mid opacity-0 group-hover:opacity-100",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      patch(s.id, (sh) => ({ ...sh, locked: !sh.locked }));
                    }}
                  >
                    {s.locked ? (
                      <LockClosedRegular style={{ fontSize: 13 }} />
                    ) : (
                      <LockOpenRegular style={{ fontSize: 13 }} />
                    )}
                  </button>
                  <button
                    title={s.visible ? "Hide" : "Show"}
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-fg-mid hover:text-fg"
                    onClick={(e) => {
                      e.stopPropagation();
                      patch(s.id, (sh) => ({ ...sh, visible: !sh.visible }));
                    }}
                  >
                    {s.visible ? <EyeRegular style={{ fontSize: 13 }} /> : <EyeOffRegular style={{ fontSize: 13 }} />}
                  </button>
                </div>
              </div>
            );
          })}
          {dropGap === shapes.length ? (
            <div className="pointer-events-none h-[2px] bg-accent" />
          ) : null}
        </div>
      )}
      {menu && menuShape ? (
        <div
          className="fixed z-50 min-w-[160px] border border-border-light bg-surface2 py-0.5 shadow-[var(--shadow-popover)]"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className={menuItem}
            onClick={() => {
              setRenaming(menuShape.id);
              setRenameText(menuShape.name ?? getShapeType(menuShape.typeId).name);
              setMenu(null);
            }}
          >
            Rename
          </button>
          <button
            className={menuItem}
            onClick={() => {
              store.update((d) => duplicateShape(d, menuShape.id));
              store.endGesture();
              setMenu(null);
            }}
          >
            Duplicate
          </button>
          <div className="my-0.5 border-t border-border" />
          <button
            className={menuItem}
            onClick={() => {
              store.update((d) => moveShapeTo(d, menuShape.id, d.shapes.length - 1));
              store.endGesture();
              setMenu(null);
            }}
          >
            Bring to Front
          </button>
          <button
            className={menuItem}
            onClick={() => {
              store.update((d) => moveShapeTo(d, menuShape.id, 0));
              store.endGesture();
              setMenu(null);
            }}
          >
            Send to Back
          </button>
          <div className="my-0.5 border-t border-border" />
          <button
            className={cx(menuItem, "text-error hover:bg-error/10")}
            onClick={() => {
              store.update((d) => removeShape(d, menuShape.id));
              store.endGesture();
              setMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
