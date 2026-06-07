import { decode } from "fast-png";
import { COMPOSITE_WGSL } from "../field/gpu/composite";
import { GpuFieldRenderer } from "../field/gpu/pipeline";
import { GRID, Orbit, orbitMvp, PREVIEW3D_WGSL } from "../field/gpu/preview3d";
import type { ShapeInstance } from "../field/types";
import type { Viewport } from "./viewport";

export type ViewMode = "diffuse" | "height" | "normal" | "lit";
export const VIEW_MODES: ViewMode[] = ["diffuse", "height", "normal", "lit"];
const MODE_INDEX: Record<ViewMode, number> = { diffuse: 0, height: 1, normal: 2, lit: 3 };

export interface PreviewParams {
  shapes: ShapeInstance[];
  viewport: Viewport;
  mode: ViewMode;
  /** Overlay opacity for height/normal modes; 1 = pure overlay (still mask-gated). */
  opacity: number;
  lightDir: [number, number, number];
  /** Height-view normalization range; pass the doc's plausible height span. */
  heightRange: [number, number];
  /** Project channel signs for the normal-view encode (normalSigns(doc.normalDirs)). */
  normalSigns: { red: number; green: number };
  /** Orbit camera for the attached 3D inspection canvas; null/undefined skips the pass. */
  orbit3d?: Orbit | null;
}

/** Owns the WebGPU canvas: doc-res field/normal textures + screen composite. */
export class PreviewRenderer {
  private gpu!: GpuFieldRenderer;
  private ctx!: GPUCanvasContext;
  private compositePipeline!: GPURenderPipeline;
  private uniforms!: GPUBuffer;
  private sizeKey = "";
  private fieldTex: GPUTexture | null = null;
  private normalTex: GPUTexture | null = null;
  private diffuseTex: GPUTexture | null = null;
  private frame: number | null = null;
  private pending: { docW: number; docH: number; params: PreviewParams } | null = null;
  private pipeline3d!: GPURenderPipeline;
  private uniforms3d!: GPUBuffer;
  private canvas3d: HTMLCanvasElement | null = null;
  private ctx3d: GPUCanvasContext | null = null;
  private depth3d: GPUTexture | null = null;

  private constructor(
    private readonly device: GPUDevice,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  static async create(canvas: HTMLCanvasElement): Promise<PreviewRenderer> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    const device = await adapter.requestDevice({
      requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
    });
    const p = new PreviewRenderer(device, canvas);
    p.gpu = await GpuFieldRenderer.create(device);
    p.ctx = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    p.ctx.configure({ device, format });
    const module = device.createShaderModule({ code: COMPOSITE_WGSL });
    p.compositePipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
    });
    p.uniforms = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const module3d = device.createShaderModule({ code: PREVIEW3D_WGSL });
    p.pipeline3d = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: module3d, entryPoint: "vs" },
      fragment: { module: module3d, entryPoint: "fs", targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    p.uniforms3d = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    return p;
  }

  /** Attach/detach the 3D inspection canvas (the orbit pass renders only while attached). */
  attach3D(canvas: HTMLCanvasElement | null): void {
    if (canvas === this.canvas3d) return;
    this.canvas3d = canvas;
    this.depth3d?.destroy();
    this.depth3d = null;
    if (!canvas) {
      this.ctx3d = null;
      return;
    }
    this.ctx3d = canvas.getContext("webgpu")!;
    this.ctx3d.configure({ device: this.device, format: navigator.gpu.getPreferredCanvasFormat() });
  }

  private render3D(docW: number, docH: number, p: PreviewParams): void {
    if (!this.ctx3d || !this.canvas3d || !p.orbit3d || !this.fieldTex || !this.normalTex || !this.diffuseTex) return;
    const w = this.canvas3d.width;
    const h = this.canvas3d.height;
    if (!this.depth3d || this.depth3d.width !== w || this.depth3d.height !== h) {
      this.depth3d?.destroy();
      this.depth3d = this.device.createTexture({
        size: [w, h],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const ub = new ArrayBuffer(96);
    new Float32Array(ub).set(orbitMvp(p.orbit3d, docW, docH, w / h), 0);
    new Float32Array(ub).set(
      [GRID, GRID, docW, docH, p.lightDir[0], p.lightDir[1], p.lightDir[2], 1],
      16,
    );
    this.device.queue.writeBuffer(this.uniforms3d, 0, ub);
    const bind = this.device.createBindGroup({
      layout: this.pipeline3d.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms3d } },
        { binding: 1, resource: this.fieldTex.createView() },
        { binding: 2, resource: this.normalTex.createView() },
        { binding: 3, resource: this.diffuseTex.createView() },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx3d.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.024, g: 0.024, b: 0.047, a: 1 },
        },
      ],
      depthStencilAttachment: {
        view: this.depth3d.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "discard",
        depthClearValue: 1,
      },
    });
    pass.setPipeline(this.pipeline3d);
    pass.setBindGroup(0, bind);
    pass.draw(GRID * GRID * 6);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** The exporter path shares this device/pipelines. */
  get fieldRenderer(): GpuFieldRenderer {
    return this.gpu;
  }

  setDiffuse(pngBytes: Uint8Array, width: number, height: number): void {
    const decoded = decode(pngBytes);
    if (decoded.width !== width || decoded.height !== height) throw new Error("diffuse dims mismatch");
    const rgba = new Uint8Array(width * height * 4);
    const ch = decoded.channels;
    for (let i = 0, n = width * height; i < n; i++) {
      const s = i * ch;
      const r = decoded.data[s]!;
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = ch >= 3 ? decoded.data[s + 1]! : r;
      rgba[i * 4 + 2] = ch >= 3 ? decoded.data[s + 2]! : r;
      rgba[i * 4 + 3] = ch === 2 || ch === 4 ? decoded.data[s + ch - 1]! : 255;
    }
    this.diffuseTex?.destroy();
    this.diffuseTex = this.device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture({ texture: this.diffuseTex }, rgba, { bytesPerRow: width * 4 }, [width, height]);
    this.sizeKey = ""; // force field texture rebuild on next render
  }

  /** Coalesce renders to one per animation frame. */
  requestRender(docW: number, docH: number, params: PreviewParams): void {
    this.pending = { docW, docH, params };
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const p = this.pending!;
      this.renderNow(p.docW, p.docH, p.params);
    });
  }

  private renderNow(docW: number, docH: number, p: PreviewParams): void {
    const key = `${docW}x${docH}`;
    if (key !== this.sizeKey) {
      this.fieldTex?.destroy();
      this.normalTex?.destroy();
      this.fieldTex = null;
      this.normalTex = null;
      this.sizeKey = key;
    }
    const existing =
      this.fieldTex && this.normalTex ? { fieldTex: this.fieldTex, normalTex: this.normalTex } : undefined;
    const tex = this.gpu.renderToTextures(p.shapes, docW, docH, existing);
    this.fieldTex = tex.fieldTex;
    this.normalTex = tex.normalTex;
    if (!this.diffuseTex) return;

    const dpr = this.canvas.width / (this.canvas.getBoundingClientRect().width || this.canvas.width) || 1;
    const ub = new ArrayBuffer(64);
    const f = new Float32Array(ub);
    const u = new Uint32Array(ub);
    f[0] = p.viewport.zoom * dpr;
    f[1] = p.viewport.panX * dpr;
    f[2] = p.viewport.panY * dpr;
    u[3] = MODE_INDEX[p.mode];
    f[4] = docW;
    f[5] = docH;
    f[6] = p.opacity;
    f[7] = p.heightRange[0];
    f[8] = p.heightRange[1];
    f[9] = p.lightDir[0];
    f[10] = p.lightDir[1];
    f[11] = p.lightDir[2];
    f[12] = p.normalSigns.red;
    f[13] = p.normalSigns.green;
    this.device.queue.writeBuffer(this.uniforms, 0, ub);

    const bind = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: this.fieldTex.createView() },
        { binding: 2, resource: this.normalTex.createView() },
        { binding: 3, resource: this.diffuseTex.createView() },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.024, g: 0.024, b: 0.047, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.render3D(docW, docH, p);
    // capture-readiness flag: the window has presented real content at least once
    (globalThis as unknown as { __flatlandFrameReady?: boolean }).__flatlandFrameReady = true;
  }
}
