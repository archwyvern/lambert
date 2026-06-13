import { decode } from "fast-png";
import { buildCompositeWgsl } from "../field/gpu/composite";
import { packShapes } from "../field/gpu/pack";
import { GpuFieldRenderer } from "../field/gpu/pipeline";
import { GRID, GRID3D_WGSL, Orbit, orbitMvp, PREVIEW3D_WGSL } from "../field/gpu/preview3d";
import type { ShapeInstance } from "../field/types";
import type { Viewport } from "./viewport";

export type ViewMode = "diffuse" | "normal" | "lit";
export const VIEW_MODES: ViewMode[] = ["diffuse", "normal", "lit"];
const MODE_INDEX: Record<ViewMode, number> = { diffuse: 0, normal: 1, lit: 2 };

export interface PreviewParams {
  shapes: ShapeInstance[];
  viewport: Viewport;
  mode: ViewMode;
  /** Overlay opacity for the normal mode; 1 = pure overlay (still mask-gated). */
  opacity: number;
  lightDir: [number, number, number];
  /** Project channel signs for the normal-view encode (normalSigns(doc.normalDirs)). */
  normalSigns: { red: number; green: number };
  /** Raster view: doc-res exported pixels (pixelated). false = crisp display-res vector view. */
  raster: boolean;
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
  /** Last folded shape list (immutable from the store): reference equality = no re-fold. */
  private lastShapes: ShapeInstance[] | null = null;
  private fieldTex: GPUTexture | null = null;
  private normalTex: GPUTexture | null = null;
  private diffuseTex: GPUTexture | null = null;
  // packed shape buffers the analytic 2D composite evaluates per fragment (cached on shape-list ref)
  private recordsBuf: GPUBuffer | null = null;
  private pointsBuf: GPUBuffer | null = null;
  private meshBuf: GPUBuffer | null = null;
  private shapeCount = 0;
  private lastShapes2d: ShapeInstance[] | null = null;
  private frame: number | null = null;
  private pending: { docW: number; docH: number; params: PreviewParams } | null = null;
  private pipeline3d!: GPURenderPipeline;
  private uniforms3d!: GPUBuffer;
  private pipelineGrid!: GPURenderPipeline;
  private uniformsGrid!: GPUBuffer;
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
    const module = device.createShaderModule({ code: buildCompositeWgsl() });
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
    const moduleGrid = device.createShaderModule({ code: GRID3D_WGSL });
    p.pipelineGrid = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: moduleGrid, entryPoint: "vs" },
      fragment: {
        module: moduleGrid,
        entryPoint: "fs",
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        // strict + a small bias so the grid never ties/bleeds with the coplanar mesh base (y=0);
        // it still shows through transparent diffuse (no depth written) and beyond the mesh
        depthCompare: "less",
        depthBias: 2,
        depthBiasSlopeScale: 3,
      },
    });
    p.uniformsGrid = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
    const mvp = orbitMvp(p.orbit3d, docW, docH, w / h);
    const ub = new ArrayBuffer(96);
    new Float32Array(ub).set(mvp, 0);
    new Float32Array(ub).set([GRID, GRID, docW, docH, p.lightDir[0], p.lightDir[1], p.lightDir[2], 1], 16);
    this.device.queue.writeBuffer(this.uniforms3d, 0, ub);

    // floor grid: a big quad at y=0 centred on the look-at target (lines are world-locked + fade out)
    const span = Math.max(docW, docH);
    const halfSize = span * p.orbit3d.dist * 10 + span; // ~ the far plane, so the quad fills the view
    const gub = new Float32Array(24);
    gub.set(mvp, 0);
    gub[16] = p.orbit3d.target.x;
    gub[17] = p.orbit3d.target.z;
    gub[18] = halfSize;
    gub[19] = 16; // minor cell size (world px)
    gub[20] = p.orbit3d.target.x;
    gub[21] = p.orbit3d.target.z;
    gub[22] = halfSize * 0.5; // distance at which the grid fully fades
    this.device.queue.writeBuffer(this.uniformsGrid, 0, gub);

    const bind = this.device.createBindGroup({
      layout: this.pipeline3d.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms3d } },
        { binding: 1, resource: this.fieldTex.createView() },
        { binding: 2, resource: this.normalTex.createView() },
        { binding: 3, resource: this.diffuseTex.createView() },
      ],
    });
    const gridBind = this.device.createBindGroup({
      layout: this.pipelineGrid.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformsGrid } }],
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
    pass.setPipeline(this.pipelineGrid);
    pass.setBindGroup(0, gridBind);
    pass.draw(6);
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

  /** Pack the shape list into the storage buffers the analytic composite reads. */
  private packShapeBuffers(shapes: ShapeInstance[]): void {
    const packed = packShapes(shapes);
    this.recordsBuf?.destroy();
    this.pointsBuf?.destroy();
    this.meshBuf?.destroy();
    const mk = (data: Float32Array): GPUBuffer => {
      const buf = this.device.createBuffer({
        size: Math.max(data.byteLength, 16),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buf, 0, data);
      return buf;
    };
    this.recordsBuf = mk(packed.records);
    this.pointsBuf = mk(packed.points);
    this.meshBuf = mk(packed.meshTris);
    this.shapeCount = packed.count;
  }

  private renderNow(docW: number, docH: number, p: PreviewParams): void {
    if (!this.diffuseTex) return;

    // doc-res field/normal textures: ONLY the 3D pass consumes them now (the 2D editor evaluates the
    // field analytically in the composite). Fold lazily when 3D is open, cached on shape-list ref.
    if (p.orbit3d) {
      const key = `${docW}x${docH}`;
      if (key !== this.sizeKey) {
        this.fieldTex?.destroy();
        this.normalTex?.destroy();
        this.fieldTex = null;
        this.normalTex = null;
        this.lastShapes = null;
        this.sizeKey = key;
      }
      if (!this.fieldTex || !this.normalTex || p.shapes !== this.lastShapes) {
        const existing =
          this.fieldTex && this.normalTex ? { fieldTex: this.fieldTex, normalTex: this.normalTex } : undefined;
        const tex = this.gpu.renderToTextures(p.shapes, docW, docH, existing);
        this.fieldTex = tex.fieldTex;
        this.normalTex = tex.normalTex;
        this.lastShapes = p.shapes;
      }
    }

    // pack the shapes the analytic composite evaluates; re-pack only when the shape list changes
    if (p.shapes !== this.lastShapes2d || !this.recordsBuf) {
      this.packShapeBuffers(p.shapes);
      this.lastShapes2d = p.shapes;
    }

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
    u[7] = this.shapeCount;
    f[8] = p.lightDir[0];
    f[9] = p.lightDir[1];
    f[10] = p.lightDir[2];
    f[11] = p.normalSigns.red;
    f[12] = p.normalSigns.green;
    u[13] = p.raster ? 1 : 0;
    this.device.queue.writeBuffer(this.uniforms, 0, ub);

    const bind = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer: this.recordsBuf! } },
        { binding: 2, resource: { buffer: this.pointsBuf! } },
        { binding: 4, resource: { buffer: this.meshBuf! } },
        { binding: 5, resource: this.diffuseTex.createView() },
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
    (globalThis as unknown as { __lambertFrameReady?: boolean }).__lambertFrameReady = true;
  }
}
