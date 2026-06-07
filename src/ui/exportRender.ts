import { GpuFieldRenderer } from "../field/gpu/pipeline";
import type { RenderResult } from "../field/render";
import type { FlatlandDoc } from "../document/schema";

let renderer: GpuFieldRenderer | null = null;

/** ss2 export render on a lazily-created renderer (independent of the preview's). */
export async function gpuExportRender(doc: FlatlandDoc): Promise<RenderResult> {
  if (!renderer) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    const device = await adapter.requestDevice({
      requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
    });
    renderer = await GpuFieldRenderer.create(device);
  }
  return renderer.evaluate(doc.shapes, doc.source.width, doc.source.height, { supersample: 2 });
}
