import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import type { DocumentStore, EditorState } from "../document/store";
import { updateShape } from "../document/docOps";
import { getShapeType } from "../field/registry";
import { cx, SectionLabel } from "./kit";
import domeIcon from "./icons/dome.png";
import grooveIcon from "./icons/groove.png";
import plateauIcon from "./icons/plateau.png";
import ridgeIcon from "./icons/ridge.png";

const SHAPE_ICONS: Record<string, string> = {
  dome: domeIcon,
  plateau: plateauIcon,
  ridge: ridgeIcon,
  groove: grooveIcon,
};

/**
 * Layer panel: every placed shape, front-most on top (photoshop convention — last in
 * the fold renders on top). The only way to select while a non-pointer tool is active.
 */
export function Layers(props: { store: DocumentStore; state: EditorState }): React.JSX.Element {
  const { store, state } = props;
  const shapes = state.doc.shapes;

  // stable display names: occurrence count per type, in fold (array) order
  const counts = new Map<string, number>();
  const labels = shapes.map((s) => {
    const n = (counts.get(s.typeId) ?? 0) + 1;
    counts.set(s.typeId, n);
    return n > 1 ? `${getShapeType(s.typeId).name} ${n}` : getShapeType(s.typeId).name;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SectionLabel>Layers</SectionLabel>
      {shapes.length === 0 ? (
        <p className="text-sm leading-snug text-fg-mid">No shapes yet.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {[...shapes.keys()].reverse().map((i) => {
            const s = shapes[i]!;
            const selected = s.id === state.selectedId;
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => store.select(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") store.select(s.id);
                }}
                className={cx(
                  "flex h-[24px] cursor-pointer items-center gap-1.5 px-1.5 text-base",
                  selected ? "bg-list-active text-fg" : "text-fg-mid hover:bg-hover hover:text-fg",
                  !s.visible && "opacity-50",
                )}
              >
                <img src={SHAPE_ICONS[s.typeId]} alt="" className="h-4.5 w-4.5 shrink-0" draggable={false} />
                <span className="min-w-0 flex-1 truncate">{labels[i]}</span>
                <button
                  title={s.visible ? "Hide" : "Show"}
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-fg-mid hover:text-fg"
                  onClick={(e) => {
                    e.stopPropagation();
                    store.update((d) => updateShape(d, s.id, (sh) => ({ ...sh, visible: !sh.visible })));
                    store.endGesture();
                  }}
                >
                  {s.visible ? <EyeRegular style={{ fontSize: 13 }} /> : <EyeOffRegular style={{ fontSize: 13 }} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
