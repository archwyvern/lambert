import type { FlatlandDoc } from "../document/schema";
import { fromLocal } from "../field/transform";
import { canvasToScreen, Viewport } from "./viewport";

/** Renders the filled faces of every Surface shape as an SVG overlay (direct paint preview). */
export function Surfaces(props: { doc: FlatlandDoc; viewport: Viewport }): React.JSX.Element {
  const { doc, viewport } = props;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {doc.shapes
        .filter((s) => s.surface && s.visible)
        .flatMap((s) =>
          s.surface!.faces.map((face, fi) => {
            const pts = face.loop
              .map((i) => canvasToScreen(viewport, fromLocal(s.transform, s.controlPoints[i]!)))
              .map((p) => `${p.x},${p.y}`)
              .join(" ");
            return <polygon key={`${s.id}-${fi}`} points={pts} fill={face.color} fillOpacity={0.9} />;
          }),
        )}
    </svg>
  );
}
