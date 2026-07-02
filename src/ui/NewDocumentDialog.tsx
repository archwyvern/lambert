import { useRef, useState } from "react";
import { Modal } from "@carapace/shell";
import { Button } from "./kit";
import { getHost } from "./host";
import { fileUri } from "../document/diffuseSource";

/**
 * New Document: pick the diffuse source for a fresh untitled doc. A document references its diffuse
 * externally — a local file (file://) or a pasted URL (http(s)://, the git-portable mode). On confirm
 * the caller resolves + decodes the source, records its dims, and opens an untitled tab.
 */
export function NewDocumentDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: (uri: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [url, setUrl] = useState("");
  const urlRef = useRef<HTMLInputElement>(null);
  const trimmed = url.trim();
  const urlValid = isHttpUrl(trimmed);

  const chooseFile = async (): Promise<void> => {
    const path = await getHost().openDialog({
      title: "Choose a diffuse image",
      filters: [{ name: "Images", extensions: ["png"] }],
    });
    if (path) onConfirm(fileUri(path));
  };

  return (
    <Modal
      title="New Document"
      onClose={onClose}
      closeOnBackdrop={false}
      initialFocus={urlRef}
      className="w-[28rem] max-w-[calc(100vw-2rem)] border border-border bg-surface-raised p-5 outline-none"
    >
      {/* content fills the panel — the panel's p-5 is the only horizontal padding (no fixed width,
          which previously exceeded the modal's max-width and spilled the fields out the right) */}
      <div className="flex flex-col gap-4">
        <p className="text-base text-fg-mid">
          A document references its diffuse image externally — pick a local file, or paste a URL to keep
          the project folder git-portable (text only, no binaries).
        </p>

        <section className="flex flex-col gap-2">
          <div className="text-sm font-medium text-fg-mid">Local file</div>
          {/* not the primary action: it opens the OS picker, which is what completes the file path.
              The footer "Create from URL" is the dialog's single primary (gold). */}
          <Button onClick={() => void chooseFile()}>Choose file…</Button>
        </section>

        <div className="flex items-center gap-3 text-sm text-fg-mid">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <section className="flex flex-col gap-2">
          <div className="text-sm font-medium text-fg-mid">Image URL</div>
          <input
            ref={urlRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && urlValid) onConfirm(trimmed);
            }}
            placeholder="https://example.com/hull.df.png"
            spellCheck={false}
            className="w-full rounded-sm border border-border bg-bg px-2 py-1.5 text-base text-fg outline-none focus:border-accent"
          />
        </section>

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!urlValid} onClick={() => onConfirm(trimmed)}>
            Create from URL
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function isHttpUrl(s: string): boolean {
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}
