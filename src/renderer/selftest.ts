import { compareRenders, DriftReport } from "../field/compare";
import { GOLDEN_H, GOLDEN_W, goldenShapes, stressShapes } from "../field/fixtures";
import { GpuFieldRenderer } from "../field/gpu/pipeline";
import { renderField } from "../field/render";
import type { ShapeInstance } from "../field/types";

declare global {
  interface Window {
    flatlandHost: { sendSelftestResult: (report: unknown) => void };
  }
}

interface CaseResult extends DriftReport {
  name: string;
}

async function runCase(
  gpu: GpuFieldRenderer,
  name: string,
  shapes: ShapeInstance[],
  supersample: 1 | 2,
  tileSize?: number,
): Promise<CaseResult> {
  const cpuResult = renderField(shapes, GOLDEN_W, GOLDEN_H, { supersample });
  const gpuResult = await gpu.evaluate(shapes, GOLDEN_W, GOLDEN_H, { supersample, tileSize });
  return { name, ...compareRenders(cpuResult, gpuResult) };
}

export async function runSelftest(): Promise<void> {
  const report: { pass: boolean; adapter?: string; error?: string; cases: CaseResult[] } = {
    pass: false,
    cases: [],
  };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    report.adapter = `${adapter.info.vendor} ${adapter.info.description ?? ""}`.trim();
    const device = await adapter.requestDevice();
    const gpu = await GpuFieldRenderer.create(device);

    report.cases.push(await runCase(gpu, "golden ss1", goldenShapes(), 1));
    report.cases.push(await runCase(gpu, "golden ss2", goldenShapes(), 2));
    report.cases.push(await runCase(gpu, "golden ss2 tiled-32", goldenShapes(), 2, 32));
    report.cases.push(await runCase(gpu, "stress ss1", stressShapes(), 1));
    report.cases.push(await runCase(gpu, "stress ss2 tiled-48", stressShapes(), 2, 48));
    report.pass = report.cases.every((c) => c.pass);
  } catch (err) {
    report.error = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  }
  document.getElementById("status")!.textContent = JSON.stringify(report, null, 2);
  window.flatlandHost.sendSelftestResult(report);
}
