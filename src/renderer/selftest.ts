import { compareRenders, DriftReport } from "../field/compare";
import { flattenLayers, resolveShapes, type ResolvedShape } from "../field/flatten";
import {
  cableShapes,
  GOLDEN_H,
  GOLDEN_W,
  goldenShapes,
  maskedShapes,
  meshShapes,
  mirrorQuadGroupLayers,
  mirrorXGroupLayers,
  nestedGroupLayers,
  planeShapes,
  primitivesShapes,
  scopedMaskGroupLayers,
  stressShapes,
} from "../field/fixtures";
import { GpuFieldRenderer } from "../field/gpu/pipeline";
import { renderField } from "../field/render";

declare global {
  interface Window {
    lambertHost: { sendSelftestResult: (report: unknown) => void };
  }
}

interface CaseResult extends DriftReport {
  name: string;
}

async function runCase(
  gpu: GpuFieldRenderer,
  name: string,
  resolved: ResolvedShape[],
  supersample: 1 | 2,
  tileSize?: number,
): Promise<CaseResult> {
  const cpuResult = renderField(resolved, GOLDEN_W, GOLDEN_H, { supersample });
  const gpuResult = await gpu.evaluate(resolved, GOLDEN_W, GOLDEN_H, { supersample, tileSize });
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

    report.cases.push(await runCase(gpu, "golden ss1", resolveShapes(goldenShapes()), 1));
    report.cases.push(await runCase(gpu, "golden ss2", resolveShapes(goldenShapes()), 2));
    report.cases.push(await runCase(gpu, "golden ss2 tiled-32", resolveShapes(goldenShapes()), 2, 32));
    report.cases.push(await runCase(gpu, "stress ss1", resolveShapes(stressShapes()), 1));
    report.cases.push(await runCase(gpu, "stress ss2 tiled-48", resolveShapes(stressShapes()), 2, 48));
    report.cases.push(await runCase(gpu, "mesh ss1", resolveShapes(meshShapes()), 1));
    report.cases.push(await runCase(gpu, "mesh ss2 tiled-48", resolveShapes(meshShapes()), 2, 48));
    report.cases.push(await runCase(gpu, "primitives ss1", resolveShapes(primitivesShapes()), 1));
    report.cases.push(await runCase(gpu, "primitives ss2 tiled-48", resolveShapes(primitivesShapes()), 2, 48));
    report.cases.push(await runCase(gpu, "plane ss1", resolveShapes(planeShapes()), 1));
    report.cases.push(await runCase(gpu, "plane ss2 tiled-48", resolveShapes(planeShapes()), 2, 48));
    report.cases.push(await runCase(gpu, "cable ss1", resolveShapes(cableShapes()), 1));
    report.cases.push(await runCase(gpu, "cable ss2 tiled-48", resolveShapes(cableShapes()), 2, 48));
    report.cases.push(await runCase(gpu, "masked ss1", resolveShapes(maskedShapes()), 1));
    report.cases.push(await runCase(gpu, "masked ss2 tiled-48", resolveShapes(maskedShapes()), 2, 48));
    report.cases.push(await runCase(gpu, "nested-group ss1", flattenLayers(nestedGroupLayers()), 1));
    report.cases.push(await runCase(gpu, "nested-group ss2 tiled-48", flattenLayers(nestedGroupLayers()), 2, 48));
    report.cases.push(await runCase(gpu, "scoped-mask ss1", flattenLayers(scopedMaskGroupLayers()), 1));
    report.cases.push(await runCase(gpu, "scoped-mask ss2 tiled-48", flattenLayers(scopedMaskGroupLayers()), 2, 48));
    report.cases.push(await runCase(gpu, "mirror-x ss1", flattenLayers(mirrorXGroupLayers()), 1));
    report.cases.push(await runCase(gpu, "mirror-x ss2 tiled-48", flattenLayers(mirrorXGroupLayers()), 2, 48));
    report.cases.push(await runCase(gpu, "mirror-quad ss1", flattenLayers(mirrorQuadGroupLayers()), 1));
    report.cases.push(await runCase(gpu, "mirror-quad ss2 tiled-48", flattenLayers(mirrorQuadGroupLayers()), 2, 48));
    report.pass = report.cases.every((c) => c.pass);
  } catch (err) {
    report.error = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  }
  document.getElementById("status")!.textContent = JSON.stringify(report, null, 2);
  window.lambertHost.sendSelftestResult(report);
}
