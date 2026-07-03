import type { DetailField } from "../field/detail";
import { flattenLayers } from "../field/flatten";
import { GpuFieldRenderer } from "../field/gpu/pipeline";
import type { RenderResult } from "../field/render";
import type { LambertDoc } from "../document/schema";

let renderer: GpuFieldRenderer | null = null;

/** ss2 export render on a lazily-created renderer (independent of the preview's). */
export async function gpuExportRender(doc: LambertDoc, detail?: DetailField | null): Promise<RenderResult> {
  if (!renderer) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      },
    });
    renderer = await GpuFieldRenderer.create(device);
  }
  return renderer.evaluate(flattenLayers(doc.layers), doc.source.width, doc.source.height, { supersample: 2, detail });
}
