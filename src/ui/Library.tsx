import { useEffect, useRef, useState } from "react";
import "../field/objects";
import { Palette, type PaletteGroup } from "@carapace/shell";
import type { SavedPreset } from "../document/schema";
import { palettePresets } from "../field/presets";
import { Button, ContextMenu } from "./kit";
import { OBJECT_ICONS } from "./objectIcons";

/** Group the palette presets into sections by category, preserving registration order; user-saved
 *  presets (project.lambert) append as a "Project" section, iconed by their template's type. */
function paletteGroups(saved: SavedPreset[]): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  for (const p of palettePresets()) {
    const group = groups.find((g) => g.label === p.category) ?? (groups.push({ label: p.category, items: [] }), groups[groups.length - 1]!);
    group.items.push({ id: p.id, label: p.name, icon: OBJECT_ICONS[p.id] });
  }
  if (saved.length > 0) {
    groups.push({ label: "Project", items: saved.map((p) => ({ id: p.id, label: p.name, icon: OBJECT_ICONS[p.object.typeId] })) });
  }
  return groups;
}

/**
 * Object picker: a compact "Add object" button opening the categorized clay-tile palette (the generic
 * carapace <Palette>) in a popover, so the left column has room for Layers + Explorer. Tiles drag onto
 * the canvas; clicking adds the object (via onPick) and closes the popover. Right-clicking a Project
 * (user-saved) tile offers Delete.
 */
export function Library(props: {
  enabled: boolean;
  onPick?: (typeId: string) => void;
  /** User-saved presets from project.lambert — the palette's "Project" section. */
  savedPresets?: SavedPreset[];
  onDeletePreset?: (id: string) => void;
}): React.JSX.Element {
  const { enabled, onPick, savedPresets = [], onDeletePreset } = props;
  const [open, setOpen] = useState(false);
  const [tileMenu, setTileMenu] = useState<{ x: number; y: number; id: string } | null>(null);
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
          groups={paletteGroups(savedPresets)}
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
          // only user-saved (Project) tiles get a menu — built-in tiles have nothing to manage
          onItemContextMenu={(id, e) => {
            if (savedPresets.some((p) => p.id === id)) setTileMenu({ x: e.clientX, y: e.clientY, id });
          }}
        />
      ) : null}
      {tileMenu ? (
        <ContextMenu
          x={tileMenu.x}
          y={tileMenu.y}
          items={[{ label: "Delete Preset", danger: true, onClick: () => onDeletePreset?.(tileMenu.id) }]}
          onClose={() => setTileMenu(null)}
        />
      ) : null}
    </div>
  );
}
