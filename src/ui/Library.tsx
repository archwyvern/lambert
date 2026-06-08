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
      <div className="grid grid-cols-2 gap-1.5">
        {allShapeTypes()
          .filter((t) => t.wgsl && !t.libraryHidden)
          .map((t) => (
            <button
              key={t.id}
              disabled={!enabled}
              title={t.name}
              className="aspect-square cursor-grab border border-border bg-surface2 p-1 transition hover:border-accent/50 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface2"
              data-shape-type={t.id}
              draggable={enabled}
              onDragStart={(e) => e.dataTransfer.setData("application/x-flatland-shape", t.id)}
            >
              {SHAPE_ICONS[t.id] ? (
                <img src={SHAPE_ICONS[t.id]} alt={t.name} className="h-full w-full" draggable={false} />
              ) : (
                <span className="text-base text-fg">{t.name}</span>
              )}
            </button>
          ))}
      </div>
      <p className="mt-2 text-sm leading-snug text-fg-mid">
        {enabled ? "Drag a shape onto the canvas." : "Open an image first (File menu)."}
      </p>
    </div>
  );
}
