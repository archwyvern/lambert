import { createRoot } from "react-dom/client";
import { createElement } from "react";

const status = document.getElementById("status")!;
const params = new URLSearchParams(location.search);

if (params.has("selftest")) {
  status.hidden = false;
  void import("./selftest").then((m) => m.runSelftest());
} else if (params.has("harness")) {
  status.hidden = false;
  void import("./harness")
    .then((m) => m.runHarness())
    .catch((err: unknown) => {
      status.textContent = `harness FAILED: ${err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)}`;
    });
} else {
  void import("../ui/App").then(({ App }) => {
    createRoot(document.getElementById("root")!).render(createElement(App));
  });
}
