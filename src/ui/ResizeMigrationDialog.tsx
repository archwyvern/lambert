import { Modal } from "@carapace/shell";
import type { ResizeMode } from "../document/migrate";
import { Button } from "./kit";

/**
 * The diffuse changed size underneath a document. Instead of refusing, offer the two migrations:
 * adopt the new canvas keeping absolute positions (artwork extended/cropped), or scale everything
 * with the canvas (artwork resized). Cancel leaves the document unopened/unchanged.
 */
export function ResizeMigrationDialog(props: {
  name: string;
  oldW: number;
  oldH: number;
  newW: number;
  newH: number;
  onPick: (mode: ResizeMode) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { name, oldW, oldH, newW, newH, onPick, onClose } = props;
  return (
    <Modal title="Diffuse changed size" onClose={onClose} closeOnBackdrop={false} className="max-w-[440px] border border-border bg-surface-raised p-5 outline-none">
      <p className="mb-3 text-base leading-snug text-fg">
        {name} is now {newW}×{newH}, but the document was authored at {oldW}×{oldH}.
      </p>
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={() => onPick("adopt")}>
          Adopt New Size
        </Button>
        <p className="px-1 text-sm leading-snug text-fg-mid">
          Objects keep their absolute positions — right for artwork that was extended or cropped.
        </p>
        <Button variant="primary" onClick={() => onPick("scale")}>
          Scale Objects With Canvas
        </Button>
        <p className="px-1 text-sm leading-snug text-fg-mid">
          Everything (objects, origin, guides) scales by {`${Math.round((newW / oldW) * 100)}%`}
          {newW / oldW !== newH / oldH ? ` × ${Math.round((newH / oldH) * 100)}%` : ""} — right for artwork that was
          resized.
        </p>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
