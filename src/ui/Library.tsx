import { useEffect, useRef, useState } from "react";
import "../field/objects";
import { Palette, type PaletteGroup } from "@carapace/shell";
import { palettePresets } from "../field/presets";
import { Button } from "./kit";
import { OBJECT_ICONS } from "./objectIcons";

/** Group the palette presets into sections by category, preserving registration order. */
function paletteGroups(): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  for (const p of palettePresets()) {
    const group = groups.find((g) => g.label === p.category) ?? (groups.push({ label: p.category, items: [] }), groups[groups.length - 1]!);
    group.items.push({ id: p.id, label: p.name, icon: OBJECT_ICONS[p.id] });
  }
  return groups;
}

/**
 * Object picker: a compact "Add object" button opening the categorized clay-tile palette (the generic
 * carapace <Palette>) in a popover, so the left column has room for Layers + Explorer. Tiles drag onto
 * the canvas; clicking adds the object (via onPick) and closes the popover.
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
        + Add object
      </Button>
      {open && enabled ? (
        <Palette
          className="absolute top-full left-0 z-30 mt-1 shadow-[var(--shadow-popover)]"
          groups={paletteGroups()}
          tileSize="6rem"
          dragMime="application/x-lambert-object"
          pickOn="doubleClick"
          // close AFTER the browser has captured the drag — closing synchronously unmounts the dragged
          // tile and aborts the native drag, so defer to the next tick.
          onDragStart={() => setTimeout(() => setOpen(false), 0)}
          onPick={(id) => {
            onPick?.(id);
            setOpen(false);
          }}
          onDragEnd={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
