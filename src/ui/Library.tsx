import "../field/shapes";
import {
  CircleRegular,
  FluentIcon,
  LineHorizontal1Regular,
  SquareRegular,
  SubtractRegular,
} from "@fluentui/react-icons";
import { allShapeTypes } from "../field/registry";
import { SectionLabel } from "./kit";

const SHAPE_ICONS: Record<string, FluentIcon> = {
  dome: CircleRegular,
  plateau: SquareRegular,
  ridge: LineHorizontal1Regular,
  groove: SubtractRegular,
};

export function Library(): React.JSX.Element {
  return (
    <div>
      <SectionLabel>Shapes</SectionLabel>
      <div className="flex flex-col gap-1">
        {allShapeTypes()
          .filter((t) => t.wgsl)
          .map((t) => {
            const Icon = SHAPE_ICONS[t.id] ?? SquareRegular;
            return (
              <button
                key={t.id}
                className="flex cursor-grab items-center gap-2 border border-border bg-surface px-2 py-1.5 text-left text-sm uppercase tracking-[var(--tracking-tight)] text-fg-mid transition hover:border-accent-dim hover:bg-accent-faint hover:text-fg"
                data-shape-type={t.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/x-flatland-shape", t.id)}
              >
                <Icon style={{ fontSize: 14 }} />
                {t.name}
              </button>
            );
          })}
      </div>
      <p className="mt-3 text-sm leading-snug text-fg-mid">Drag a shape onto the canvas to place it.</p>
    </div>
  );
}
