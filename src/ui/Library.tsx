import "../field/shapes";
import { allShapeTypes } from "../field/registry";
import { SectionLabel } from "./kit";
import domeIcon from "./icons/dome.png";
import grooveIcon from "./icons/groove.png";
import plateauIcon from "./icons/plateau.png";
import ridgeIcon from "./icons/ridge.png";

/** Clay renders of the actual shapes (blender/render_icons.py regenerates them). */
const SHAPE_ICONS: Record<string, string> = {
  dome: domeIcon,
  plateau: plateauIcon,
  ridge: ridgeIcon,
  groove: grooveIcon,
};

export function Library(props: { enabled: boolean }): React.JSX.Element {
  const { enabled } = props;
  return (
    <div>
      <SectionLabel>Shapes</SectionLabel>
      <div className="flex flex-col gap-1">
        {allShapeTypes()
          .filter((t) => t.wgsl)
          .map((t) => (
            <button
              key={t.id}
              disabled={!enabled}
              className="flex cursor-grab items-center gap-2 border border-border bg-surface2 px-2 py-1 text-left text-base text-fg transition hover:border-border-light hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-surface2"
              data-shape-type={t.id}
              draggable={enabled}
              onDragStart={(e) => e.dataTransfer.setData("application/x-flatland-shape", t.id)}
            >
              {SHAPE_ICONS[t.id] ? (
                <img src={SHAPE_ICONS[t.id]} alt="" className="h-7 w-7 shrink-0" draggable={false} />
              ) : null}
              {t.name}
            </button>
          ))}
      </div>
      <p className="mt-3 text-sm leading-snug text-fg-mid">
        {enabled ? "Drag a shape onto the canvas to place it." : "Open an image first (File menu)."}
      </p>
    </div>
  );
}
