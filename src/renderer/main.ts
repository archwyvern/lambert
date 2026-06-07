const status = document.getElementById("status")!;

const params = new URLSearchParams(location.search);
if (params.has("selftest")) {
  void import("./selftest").then((m) => m.runSelftest());
} else {
  void import("./harness")
    .then((m) => m.runHarness())
    .catch((err: unknown) => {
      status.textContent = `harness FAILED: ${err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)}`;
    });
}

export {}; // module scope: keeps `status` from colliding with window.status
