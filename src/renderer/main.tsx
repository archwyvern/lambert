import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { createRoot } from "react-dom/client";
import { ConfirmProvider, HostProvider, ToastProvider } from "@carapace/shell";
import { carapaceHost } from "../ui/host";

const status = document.getElementById("status")!;
const params = new URLSearchParams(location.search);

if (params.has("selftest")) {
  status.hidden = false;
  void import("./selftest").then((m) => m.runSelftest());
} else if (params.has("davcheck")) {
  status.hidden = false;
  void import("./davcheck")
    .then((m) => m.runDavCheck())
    .catch((err: unknown) => {
      status.textContent = `davcheck FAILED: ${err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)}`;
    });
} else if (params.has("harness")) {
  status.hidden = false;
  void import("./harness")
    .then((m) => m.runHarness())
    .catch((err: unknown) => {
      status.textContent = `harness FAILED: ${err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)}`;
    });
} else {
  void import("../ui/App").then(({ App }) => {
    createRoot(document.getElementById("root")!).render(
      <HostProvider host={carapaceHost}>
        <ConfirmProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ConfirmProvider>
      </HostProvider>,
    );
  });
}
