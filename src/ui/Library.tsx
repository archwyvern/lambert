import "../field/shapes";
import { allShapeTypes } from "../field/registry";

export function Library(): React.JSX.Element {
  return (
    <div>
      <div className="mb-2 font-semibold text-fg-mid">Shapes</div>
      <div className="flex flex-col gap-1">
        {allShapeTypes()
          .filter((t) => t.wgsl)
          .map((t) => (
            <button
              key={t.id}
              className="rounded border border-panel-edge bg-canvasbg px-2 py-1.5 text-left hover:border-accent"
              data-shape-type={t.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/x-flatland-shape", t.id)}
            >
              {t.name}
            </button>
          ))}
      </div>
    </div>
  );
}
