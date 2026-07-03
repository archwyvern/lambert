import { decode } from "fast-png";
import { flattenLayers, type ResolvedObject } from "../field/flatten";
import type { DetailField } from "../field/detail";
import { buildCompositeWgsl } from "../field/gpu/composite";
import { detailBuffer } from "../field/gpu/pipeline";
import { packObjects } from "../field/gpu/pack";
import { GpuFieldRenderer } from "../field/gpu/pipeline";
import { buildPreview3dWgsl, GRID3D_WGSL, Orbit, orbitMvp } from "../field/gpu/preview3d";
import type { LayerNode } from "../field/types";
import type { Viewport } from "./viewport";

export type ViewMode = "diffuse" | "normal" | "lit" | "coverage";
export const VIEW_MODES: ViewMode[] = ["diffuse", "normal", "lit", "coverage"];
const MODE_INDEX: Record<ViewMode, number> = { diffuse: 0, normal: 1, lit: 2, coverage: 3 };

// 3D displaced-grid resolution cap: the grid is sized to the doc (1 cell ~= 1 doc px) so hard height
// cliffs read crisply, clamped here so very large docs don't explode the vertex count (512^2*6 ~= 1.5M).
const GRID_MAX = 512;

export interface PreviewParams {
  layers: LayerNode[];
  viewport: Viewport;
  mode: ViewMode;
  /** Overlay opacity for the normal mode; 1 = pure overlay (still mask-gated). */
  opacity: number;
  lightDir: [number, number, number];
  /** Lit-mode light intensity multiplier (1 = default). */
  lightEnergy: number;
  /** The XY encode transform for the normal view (normalXform of the effective dirs). */
  normalXform: { xx: number; xy: number; yx: number; yy: number };
  /** Orbit camera for the attached 3D inspection canvas; null/undefined skips the pass. */
  orbit3d?: Orbit | null;
  /** The Emboss/Detail bands for this doc (null when no detail adjustment exists). */
  detail?: DetailField | null;
  /** Normal view: hide the encode where the diffuse is fully transparent (matches the export's
   *  alpha gate). Default on. */
  normalAlphaGate?: boolean;
}

/** Owns the WebGPU canvas: the analytic 2D composite + the 3D inspection pass (both evaluate the
 *  field straight from the packed object buffers — no pre-folded textures). */
/** Perf-probe collector (the `perf=` capture aid): when installed on globalThis, renderNow reports
 *  per-frame CPU (pack/encode) and GPU (onSubmittedWorkDone) timings into it. Zero cost when absent. */
export interface PerfProbe {
  frames: { packMs: number; cpuMs: number; gpuMs: number }[];
}

export class PreviewRenderer {
  private gpu!: GpuFieldRenderer;
  private ctx!: GPUCanvasContext;
  private compositePipeline!: GPURenderPipeline;
  private uniforms!: GPUBuffer;
  private diffuseTex: GPUTexture | null = null;
  // Decoded diffuse cache keyed on the source byte buffer (stable per open tab). Switching tabs just
  // rebinds the cached texture instead of re-decoding a multi-MP PNG + re-uploading. Bounded by open
  // tabs: when a tab closes its bytes are unreachable, so the entry (and its GPU texture) is GC'd.
  private diffuseCache = new WeakMap<Uint8Array, GPUTexture>();
  // packed object buffers the analytic 2D composite evaluates per fragment (cached on object-list ref)
  private recordsBuf: GPUBuffer | null = null;
  private pointsBuf: GPUBuffer | null = null;
  private meshBuf: GPUBuffer | null = null;
  private maskLoopsBuf: GPUBuffer | null = null;
  private maskVertsBuf: GPUBuffer | null = null;
  private detailBuf: GPUBuffer | null = null;
  private lastDetail: DetailField | null | undefined = undefined; // sentinel: never uploaded
  private shapeCount = 0;
  private packSeq = 0;
  private lastShapes2d: LayerNode[] | null = null;
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
      // raise buffer limits to the adapter's max — large images make the doc-res field/normal textures
      // (and their upload staging) exceed the default 256MB maxBufferSize, which crashes the device.
      requiredLimits: {
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      },
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
    const module3d = device.createShaderModule({ code: buildPreview3dWgsl() });
    p.pipeline3d = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: module3d, entryPoint: "vs" },
      fragment: { module: module3d, entryPoint: "fs", targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    p.uniforms3d = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
    if (!this.ctx3d || !this.canvas3d || !p.orbit3d || !this.diffuseTex || !this.recordsBuf) return;
    const w = this.canvas3d.width;
    const h = this.canvas3d.height;
    const l = this.last3d;
    if (
      l &&
      l.packSeq === this.packSeq &&
      l.orbit === p.orbit3d &&
      l.lx === p.lightDir[0] &&
      l.ly === p.lightDir[1] &&
      l.lz === p.lightDir[2] &&
      l.detail === (p.detail ?? null) &&
      l.w === w &&
      l.h === h &&
      l.docW === docW &&
      l.docH === docH &&
      l.tex === this.diffuseTex
    ) {
      return; // the canvas keeps presenting its last frame — nothing 3D-relevant changed
    }
    this.last3d = {
      packSeq: this.packSeq,
      orbit: p.orbit3d,
      lx: p.lightDir[0],
      ly: p.lightDir[1],
      lz: p.lightDir[2],
      detail: p.detail ?? null,
      w,
      h,
      docW,
      docH,
      tex: this.diffuseTex,
    };
    if (!this.depth3d || this.depth3d.width !== w || this.depth3d.height !== h) {
      this.depth3d?.destroy();
      this.depth3d = this.device.createTexture({
        size: [w, h],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const mvp = orbitMvp(p.orbit3d, docW, docH, w / h);
    // Match the displaced grid to the doc resolution (capped) so one grid cell ~= one doc pixel: a
    // hard height step (mask cut / silhouette) then renders as a ~1px cliff the cliff-cull discards,
    // instead of a shallow ramp smeared across a coarse cell. Capped so huge docs stay performant.
    const gw = Math.min(docW, GRID_MAX);
    const gh = Math.min(docH, GRID_MAX);
    const ub = new ArrayBuffer(112);
    new Float32Array(ub).set(mvp, 0);
    new Float32Array(ub).set([gw, gh, docW, docH, p.lightDir[0], p.lightDir[1], p.lightDir[2], 1], 16);
    new Uint32Array(ub)[24] = this.shapeCount; // shapeCount (analytic fold loop bound)
    new Float32Array(ub)[25] = 1; // slopeScale
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

    // analytic field eval reuses the SAME packed object buffers the 2D composite uploads (records/
    // points/mesh/masks); no pre-folded field/normal textures. diffuse stays at binding 3.
    const bind = this.device.createBindGroup({
      layout: this.pipeline3d.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms3d } },
        { binding: 1, resource: { buffer: this.recordsBuf! } },
        { binding: 2, resource: { buffer: this.pointsBuf! } },
        { binding: 3, resource: this.diffuseTex.createView() },
        { binding: 4, resource: { buffer: this.meshBuf! } },
        { binding: 6, resource: { buffer: this.maskLoopsBuf! } },
        { binding: 7, resource: { buffer: this.maskVertsBuf! } },
        { binding: 8, resource: { buffer: this.detailBuf! } },
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
    pass.draw(gw * gh * 6); // matches the gridW/gridH uniform set above
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
    // Switching back to an already-decoded tab: rebind its texture, skip the decode/build/upload.
    const cached = this.diffuseCache.get(pngBytes);
    if (cached) {
      this.diffuseTex = cached;
      return;
    }
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
    // Don't destroy the outgoing texture: it's owned by the cache (another tab may still need it).
    const tex = this.device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture({ texture: tex }, rgba, { bytesPerRow: width * 4 }, [width, height]);
    this.diffuseCache.set(pngBytes, tex);
    this.diffuseTex = tex;
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

  /** Pack the object list into the storage buffers the analytic composite reads. */
  private packObjectBuffers(resolved: ResolvedObject[]): void {
    const packed = packObjects(resolved);
    this.recordsBuf?.destroy();
    this.pointsBuf?.destroy();
    this.meshBuf?.destroy();
    this.maskLoopsBuf?.destroy();
    this.maskVertsBuf?.destroy();
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
    this.maskLoopsBuf = mk(packed.maskLoops);
    this.maskVertsBuf = mk(packed.maskVerts);
    this.shapeCount = packed.count;
  }

  // 3D-pass input signature — render3D skips when none of ITS inputs changed, so 2D-only work
  // (pan/zoom, mode/opacity, overlays) never pays for the displaced-grid fold.
  private last3d: {
    packSeq: number;
    orbit: Orbit;
    lx: number;
    ly: number;
    lz: number;
    detail: DetailField | null;
    w: number;
    h: number;
    docW: number;
    docH: number;
    tex: GPUTexture;
  } | null = null;

  private renderNow(docW: number, docH: number, p: PreviewParams): void {
    if (!this.diffuseTex) return;
    const probe = (globalThis as { __lambertPerf?: PerfProbe }).__lambertPerf;
    const t0 = probe ? performance.now() : 0;

    // pack the objects BOTH analytic passes evaluate (2D composite + 3D preview); re-pack only when the
    // layer tree changes
    let packMs = 0;
    if (p.layers !== this.lastShapes2d || !this.recordsBuf) {
      this.packObjectBuffers(flattenLayers(p.layers));
      this.lastShapes2d = p.layers;
      this.packSeq++;
      if (probe) packMs = performance.now() - t0;
    }

    const dpr = this.canvas.width / (this.canvas.getBoundingClientRect().width || this.canvas.width) || 1;
    const ub = new ArrayBuffer(64);
    const f = new Float32Array(ub);
    const u = new Uint32Array(ub);
    f[0] = p.viewport.zoom * dpr;
    f[1] = p.viewport.panX * dpr;
    f[2] = p.viewport.panY * dpr;
    u[3] = MODE_INDEX[p.mode] | (p.normalAlphaGate !== false ? 8 : 0); // bit 3 = normal-view alpha gate
    f[4] = docW;
    f[5] = docH;
    f[6] = p.opacity;
    u[7] = this.shapeCount;
    f[8] = p.lightDir[0];
    f[9] = p.lightDir[1];
    f[10] = p.lightDir[2];
    f[11] = p.normalXform.xx;
    f[12] = p.normalXform.xy;
    f[13] = p.normalXform.yx;
    f[14] = p.normalXform.yy;
    f[15] = p.lightEnergy;
    this.device.queue.writeBuffer(this.uniforms, 0, ub);

    // detail bands: (re)upload only when the field object changes (per diffuse+doc, cached upstream)
    if (this.lastDetail !== (p.detail ?? null)) {
      this.detailBuf?.destroy();
      this.detailBuf = detailBuffer(this.device, p.detail ?? null, 1); // composite p is doc-space
      this.lastDetail = p.detail ?? null;
    }
    const bind = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer: this.recordsBuf! } },
        { binding: 2, resource: { buffer: this.pointsBuf! } },
        { binding: 4, resource: { buffer: this.meshBuf! } },
        { binding: 5, resource: this.diffuseTex.createView() },
        { binding: 6, resource: { buffer: this.maskLoopsBuf! } },
        { binding: 7, resource: { buffer: this.maskVertsBuf! } },
        { binding: 8, resource: { buffer: this.detailBuf! } },
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
    if (probe) {
      const cpuMs = performance.now() - t0;
      const rec = { packMs, cpuMs, gpuMs: -1 };
      probe.frames.push(rec);
      void this.device.queue.onSubmittedWorkDone().then(() => {
        rec.gpuMs = performance.now() - t0;
      });
    }
    // capture-readiness flag: the window has presented real content at least once
    (globalThis as unknown as { __lambertFrameReady?: boolean }).__lambertFrameReady = true;
  }
}
