export {}; // module scope: keeps `status` from colliding with window.status

const status = document.getElementById("status")!;

async function probe(): Promise<void> {
  if (!navigator.gpu) throw new Error("navigator.gpu missing — WebGPU not enabled");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("requestAdapter() returned null — no usable GPU");
  const info = adapter.info;
  status.textContent = `WebGPU adapter: ${info.vendor} ${info.architecture ?? ""} (${info.description || "no description"})`;
}

probe().catch((err: unknown) => {
  status.textContent = `WebGPU FAILED: ${err instanceof Error ? err.message : String(err)}`;
});
