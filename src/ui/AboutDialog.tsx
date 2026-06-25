import { Modal } from "@carapace/shell";
import { LambertMark } from "./LambertMark";

/** Help -> About: app identity, version, author, copyright. The version is baked in at build time
 *  (Vite `define`), so it reflects whatever electron-builder packaged. */
export function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title="About Lambert" onClose={onClose}>
      {/* select-text re-enables copying (the shell base layer disables it on chrome) so the version
          and repo URL are copyable */}
      <div className="flex select-text flex-col items-center gap-3 px-6 pb-3 pt-1 text-center">
        <LambertMark className="h-16 w-16" />
        <div>
          <div className="text-lg font-semibold text-fg">Lambert</div>
          <div className="text-sm text-fg-mid">Version {__APP_VERSION__}</div>
        </div>
        <p className="max-w-xs text-base text-fg-mid">Object-based height-field authoring for normal maps.</p>
        <div className="space-y-0.5 text-sm text-fg-mid">
          <div>Created by Archwyvern</div>
          <div>Copyright © 2026 Archwyvern</div>
          <div className="pt-1 font-mono text-2xs text-fg-mid">github.com/archwyvern/lambert</div>
        </div>
      </div>
    </Modal>
  );
}
