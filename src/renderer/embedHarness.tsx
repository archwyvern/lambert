import "../ui/styles.css";
import "@carapace/shell/seti.css";
import { createRoot } from "react-dom/client";
import { encode } from "fast-png";
import { ConfirmProvider, HostProvider, ToastProvider } from "@carapace/shell";
import { carapaceHost } from "../ui/host";
import { LambertEditor, type EmbedHost } from "../embed";

/**
 * `?embed` capture/dev harness: mounts <LambertEditor> with a generated demo diffuse and a
 * console-logging host, proving the embedded editor renders with no shell. Save/export just log.
 */
export function runEmbedHarness(): void {
  const W = 128;
  const H = 128;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = 170;
      data[i + 1] = 140;
      data[i + 2] = 220;
      data[i + 3] = 255;
    }
  }
  const host: EmbedHost = {
    diffuse: encode({ width: W, height: H, data }),
    initialDoc: null,
    onSave: async (doc) => console.log("[embed] onSave", doc),
    onExportNx: async (png, doc) => console.log("[embed] onExportNx", png.length, "bytes", doc),
  };
  createRoot(document.getElementById("root")!).render(
    <HostProvider host={carapaceHost}>
      <ConfirmProvider>
        <ToastProvider>
          <div className="fixed inset-0">
            <LambertEditor host={host} />
          </div>
        </ToastProvider>
      </ConfirmProvider>
    </HostProvider>,
  );
}
