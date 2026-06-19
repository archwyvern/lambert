import { useEffect, useRef, useState } from "react";
import "../field/shapes";
import { allShapeTypes } from "../field/registry";
import type { ShapeType } from "../field/types";
import { Button, SectionLabel } from "./kit";
import { SHAPE_ICONS } from "./shapeIcons";

/** Group the palette shapes by category, preserving registration order. */
function byCategory(): { category: string; types: ShapeType[] }[] {
  const groups: { category: string; types: ShapeType[] }[] = [];
  for (const t of allShapeTypes()) {
    if (!t.wgsl || t.libraryHidden) continue;
    const category = t.category ?? "Other";
    const group = groups.find((g) => g.category === category) ?? (groups.push({ category, types: [] }), groups[groups.length - 1]!);
    group.types.push(t);
  }
  return groups;
}

/**
 * Shape picker: a compact "Add shape" button opening a categorized clay-tile grid in a popover,
 * so the left column has room for Layers + Explorer. Tiles drag onto the canvas; clicking adds
 * the shape (via onPick) and closes the popover.
 */
export function Library(props: { enabled: boolean; onPick?: (typeId: string) => void }): React.JSX.Element {
  const { enabled, onPick } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onBlur = (): void => setOpen(false);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <Button variant="ghost" disabled={!enabled} onClick={() => setOpen((o) => !o)} className="w-full">
        + Add shape
      </Button>
      {open && enabled ? (
        <div className="absolute top-full left-0 z-30 mt-1 max-h-[70vh] w-80 overflow-y-auto border border-border-light bg-surface2 p-2 shadow-[var(--shadow-popover)]">
          {byCategory().map((group) => (
            <div key={group.category} className="mb-2 last:mb-0">
              <SectionLabel>{group.category}</SectionLabel>
              <div className="grid grid-cols-4 gap-1.5">
                {group.types.map((t) => (
                  <button
                    key={t.id}
                    title={t.name}
                    className="aspect-square cursor-grab border border-border bg-bg p-1 transition hover:border-accent/50 hover:bg-hover"
                    data-shape-type={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("application/x-lambert-shape", t.id)}
                    onDragEnd={() => setOpen(false)}
                    onClick={() => {
                      onPick?.(t.id);
                      setOpen(false);
                    }}
                  >
                    {SHAPE_ICONS[t.id] ? (
                      <img src={SHAPE_ICONS[t.id]} alt={t.name} className="h-full w-full" draggable={false} />
                    ) : (
                      <span className="text-base text-fg">{t.name}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
