import { useState } from "react";
import { Modal } from "@carapace/shell";
import { getHost } from "./host";
import { Button } from "./kit";
import { LambertMark } from "./LambertMark";

/** Help -> About: app identity plus a vscode-style diagnostics block (version, commit + build
 *  date, Electron/Chromium/Node/V8, OS) with Copy. Explicit Close button; Esc still closes, but a
 *  stray click outside doesn't (you're usually mid-copy). Version/commit/date are baked in at
 *  build time (Vite `define`); the runtime versions come from the preload. */
export function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const diag = (() => {
    try {
      return getHost().diagnostics();
    } catch {
      return { electron: "?", chromium: "?", node: "?", v8: "?", os: "?" }; // browser/dev harness
    }
  })();
  const rows: Array<[string, string]> = [
    ["Version", __APP_VERSION__],
    ["Commit", `${__APP_COMMIT__} (${__APP_BUILD_DATE__})`],
    ["Electron", diag.electron],
    ["Chromium", diag.chromium],
    ["Node", diag.node],
    ["V8", diag.v8],
    ["OS", diag.os],
  ];
  const copy = (): void => {
    void navigator.clipboard.writeText(rows.map(([k, v]) => `${k}: ${v}`).join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Modal title="About Lambert" onClose={onClose} closeOnBackdrop={false}>
      {/* select-text re-enables copying (the shell base layer disables it on chrome) */}
      <div className="flex select-text flex-col items-center gap-3 px-6 pb-1 pt-1 text-center">
        <LambertMark className="h-16 w-16" />
        <div>
          <div className="text-lg font-semibold text-fg">Lambert</div>
          <div className="text-sm text-fg-mid">Object-based height-field authoring for normal maps</div>
        </div>
        <table className="text-left font-mono text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="pr-3 text-fg-mid">{k}</td>
                <td className="text-fg">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-0.5 text-sm text-fg-mid">
          <div>
            Built for{" "}
            <a
              href="https://www.instagram.com/sketchy_pigeon/"
              target="_blank"
              rel="noreferrer"
              className="text-link hover:underline"
            >
              Pigeon
            </a>
            , who also designed the logo.
          </div>
          <div>Copyright © 2026 Archwyvern</div>
          <div className="font-mono">github.com/archwyvern/lambert</div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
