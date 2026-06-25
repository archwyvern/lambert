import { GOLDEN_H, GOLDEN_W, goldenObjects } from "../field/fixtures";
import { resolveObjects } from "../field/flatten";
import { GpuFieldRenderer } from "../field/gpu/pipeline";
import { LIT_WGSL } from "../field/gpu/lit";
import { encodeNormalPng } from "../exporters/normalmap";

const SCALE = 5;

export async function runHarness(): Promise<void> {
  const status = document.getElementById("status")!;
  const views = document.getElementById("views")!;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("no WebGPU adapter");
  const device = await adapter.requestDevice();
  const gpu = await GpuFieldRenderer.create(device);
  status.textContent = `adapter: ${adapter.info.vendor} — golden fixture ${GOLDEN_W}x${GOLDEN_H}, drag mouse over lit view to move the light`;

  // Normal-map view: CPU-encode the GPU result into a PNG blob for a plain <img>
  const result = await gpu.evaluate(resolveObjects(goldenObjects()), GOLDEN_W, GOLDEN_H, { supersample: 2 });
  const png = encodeNormalPng(result.normals, result.width, result.height, { red: "right", green: "up" });
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
  img.width = GOLDEN_W * SCALE;
  img.height = GOLDEN_H * SCALE;
  img.style.imageRendering = "pixelated";
  views.appendChild(img);

  // Lit view: live GPU render, light follows the mouse
  const canvas = document.createElement("canvas");
  canvas.width = GOLDEN_W;
  canvas.height = GOLDEN_H;
  canvas.style.width = `${GOLDEN_W * SCALE}px`;
  canvas.style.height = `${GOLDEN_H * SCALE}px`;
  views.appendChild(canvas);
  const ctx = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format });

  // re-run fold+normal at native res into a texture we can sample
  const native = await gpu.evaluate(resolveObjects(goldenObjects()), GOLDEN_W, GOLDEN_H);
  const normalTex = device.createTexture({
    size: [GOLDEN_W, GOLDEN_H],
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const rowBytes = GOLDEN_W * 16;
  const upload = new Float32Array(GOLDEN_W * GOLDEN_H * 4);
  for (let i = 0; i < GOLDEN_W * GOLDEN_H; i++) {
    upload[i * 4] = native.normals[i * 3]!;
    upload[i * 4 + 1] = native.normals[i * 3 + 1]!;
    upload[i * 4 + 2] = native.normals[i * 3 + 2]!;
    upload[i * 4 + 3] = native.mask[i]!;
  }
  device.queue.writeTexture({ texture: normalTex }, upload, { bytesPerRow: rowBytes }, [GOLDEN_W, GOLDEN_H]);

  const litModule = device.createShaderModule({ code: LIT_WGSL });
  const litPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: litModule, entryPoint: "vs" },
    fragment: { module: litModule, entryPoint: "fs", targets: [{ format }] },
  });
  const lightBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({
    layout: litPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: normalTex.createView() },
      { binding: 1, resource: { buffer: lightBuf } },
    ],
  });

  const draw = (lx: number, ly: number): void => {
    device.queue.writeBuffer(lightBuf, 0, new Float32Array([lx, ly, 0.7, 0]));
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(litPipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  draw(-0.5, -0.5);
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    draw(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  });
}
