import { decode } from "fast-png";
import type { AdjustmentDefaults } from "../field/adjustments";
import { flattenLayers, type ResolvedObject } from "../field/flatten";
import type { DetailField } from "../field/detail";
import { buildCompositeWgsl } from "../field/gpu/composite";
import { buildFoldWgsl } from "../field/gpu/wgsl";
import { detailBuffer } from "../field/gpu/pipeline";
import { packObjects } from "../field/gpu/pack";
import { GpuFieldRenderer } from "../field/gpu/pipeline";
import { buildPreview3dWgsl, GRID3D_WGSL, Orbit, orbitMvp } from "../field/gpu/preview3d";
import type { LayerNode } from "../field/types";
import type { Viewport } from "./viewport";

export type ViewMode = "diffuse" | "normal" | "lit" | "coverage";
export const VIEW_MODES: ViewMode[] = ["diffuse", "normal", "coverage"]; // editor-selectable modes; "lit" now lives only in the 3D box preview
const MODE_INDEX: Record<ViewMode, number> = { diffuse: 0, normal: 1, lit: 2, coverage: 3 };

// 3D displaced-grid resolution cap: the grid is sized to the doc (1 cell ~= 1 doc px) so hard height
// cliffs read crisply, clamped here so very large docs don't explode the vertex count (512^2*6 ~= 1.5M).
const GRID_MAX = 512;

/** A lit-preview point light. Position/height are fractions (0..1 of the doc / its larger dim) so they're
 *  resolution-independent; the handles in the lit preview edit x/y, the widget edits the rest. */
export interface PointLight {
  on: boolean;
  x: number;
  y: number;
  height: number;
  intensity: number;
  color: [number, number, number];
}

export interface PreviewParams {
  layers: LayerNode[];
  viewport: Viewport;
  mode: ViewMode;
  /** Overlay opacity for the normal mode; 1 = pure overlay (still mask-gated). */
  opacity: number;
  lightDir: [number, number, number];
  /** Lit-mode light intensity multiplier (1 = default). */
  lightEnergy: number;
  /** Lit-preview point lights (rendered in the box's Lit view; ignored by the diffuse/normal modes). */
  pointLights?: PointLight[];
  /** The XY encode transform for the normal view (normalXform of the effective dirs). */
  normalXform: { xx: number; xy: number; yx: number; yy: number };
  /** Project default params for inheriting adjustment entries (absent = factory defaults). */
  defaults?: AdjustmentDefaults;
  /** Orbit camera for the attached 3D inspection canvas; null/undefined skips the pass. */
  orbit3d?: Orbit | null;
  /** What the 3D inspection box draws: "3d" = the orbit displaced-grid pass; "lit" = the lit composite
   *  (the 2D lit view, fit to the box). Only consulted when the box is on (orbit3d present). */
  boxMode?: "3d" | "lit";
  /** The box's own 2D lit camera (independent of the main viewport), in the box's CSS px. Undefined/null
   *  falls back to a centred auto-fit. */
  boxLitViewport?: Viewport | null;
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

// Escape hatch for A/B comparison + emergencies: `?nofoldcache` forces every frame down the direct
// per-fragment fold path (the pre-cache behavior).
const FOLD_CACHE_DISABLED = typeof location !== "undefined" && new URLSearchParams(location.search).has("nofoldcache");

// Doc-px padding around the visible doc window in the fold cache texture: pans/zoom-ins inside the
// apron are pure texture reads (no fold at all); escaping it re-folds the (small) window once.
const FOLD_APRON = 192;

// Docs at or under this texel count (2048², ~34MB rg32float) fold whole-doc instead of windowed —
// then NO pan can ever invalidate the cache, only content/detail edits.
const FOLD_FULL_DOC_TEXELS = 4_194_304;

export class PreviewRenderer {
  private gpu!: GpuFieldRenderer;
  private ctx!: GPUCanvasContext;
  private compositePipeline!: GPURenderPipeline;
  private compositeCachedPipeline!: GPURenderPipeline;
  private foldPipeline!: GPUComputePipeline;
  private uniforms!: GPUBuffer;
  private boxUniforms!: GPUBuffer; // separate uniform buffer for the lit-in-box composite pass
  private foldUniforms!: GPUBuffer; // fold compute pass uniforms (window origin + size)
  private foldWinBuf!: GPUBuffer; // cached-composite uniform: the fold window origin
  private foldTex: GPUTexture | null = null;
  // fold-cache validity: the packed-content generation + detail + doc dims it was folded for, and
  // the doc-space window it covers (a hit needs the visible window CONTAINED in it)
  private foldCache: { packSeq: number; detail: DetailField | null; docW: number; docH: number; x: number; y: number; w: number; h: number } | null = null;
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
  private lastDefaults: AdjustmentDefaults | undefined;
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
    const format = navigator.gpu.getPreferredCanvasFormat();
    const module = device.createShaderModule({ code: buildCompositeWgsl() });
    const cachedModule = device.createShaderModule({ code: buildCompositeWgsl(true) });
    const foldModule = device.createShaderModule({ code: buildFoldWgsl() });
    [p.compositePipeline, p.compositeCachedPipeline, p.foldPipeline] = await Promise.all([
      device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format }] },
      }),
      device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: cachedModule, entryPoint: "vs" },
        fragment: { module: cachedModule, entryPoint: "fs", targets: [{ format }] },
      }),
      device.createComputePipelineAsync({ layout: "auto", compute: { module: foldModule, entryPoint: "fold" } }),
    ]);
    p.uniforms = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    p.boxUniforms = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    p.foldUniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    p.foldWinBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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

  /** Claim the 2D canvas: configure its WebGPU context with THIS renderer's device. Must be called
   *  once by the winning owner AFTER create() resolves — never inside create(), where two racing
   *  creates (React StrictMode's dev double-mount) would leave the canvas configured with one
   *  device while the surviving renderer submits from the other (every frame then fails validation
   *  and the canvas stays black). */
  attach(): void {
    this.ctx = this.canvas.getContext("webgpu")!;
    this.ctx.configure({ device: this.device, format: navigator.gpu.getPreferredCanvasFormat() });
  }

  /** Tear down: cancel the pending frame and destroy the device (and with it every GPU resource).
   *  For the unmount/loser path of the create() race — the instance is unusable afterwards. */
  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.device.destroy();
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
  private packObjectBuffers(resolved: ResolvedObject[], defaults?: AdjustmentDefaults): void {
    const packed = packObjects(resolved, defaults);
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

  // Draw the LIT composite into the 3D box canvas — the same analytic fragment as the main viewport's
  // Lit view, reusing the already-packed field buffers, so it's pixel-identical (not the tessellated 3D
  // mesh). The box has its OWN fit-to-box camera (independent of the main viewport, non-interactive):
  // the whole doc centred in the box with ~10% padding, computed in device px (canvas3d.width is device
  // px, so the composite's zoom/pan uniform is used directly — no dpr factor). Runs after renderNow, so
  // the field buffers + diffuse + detail are already current for this frame.
  private renderLitToBox(docW: number, docH: number, p: PreviewParams): void {
    if (!this.ctx3d || !this.canvas3d || !this.diffuseTex || !this.recordsBuf) return;
    // The box owns its lit camera (Preview3D drives pan/zoom); it arrives in the box's CSS px, so scale by
    // the box dpr into device px. Before the first report (or if absent) fall back to a centred auto-fit.
    let zoom: number, panX: number, panY: number;
    if (p.boxLitViewport) {
      const dpr = this.canvas3d.width / (this.canvas3d.getBoundingClientRect().width || this.canvas3d.width) || 1;
      zoom = p.boxLitViewport.zoom * dpr;
      panX = p.boxLitViewport.panX * dpr;
      panY = p.boxLitViewport.panY * dpr;
    } else {
      const boxW = this.canvas3d.width;
      const boxH = this.canvas3d.height;
      zoom = Math.min(boxW / docW, boxH / docH) * 0.9;
      panX = (boxW - docW * zoom) / 2;
      panY = (boxH - docH * zoom) / 2;
    }
    const ub = new ArrayBuffer(128); // 64 base + 64 point-light block
    const f = new Float32Array(ub);
    const u = new Uint32Array(ub);
    f[0] = zoom;
    f[1] = panX;
    f[2] = panY;
    u[3] = MODE_INDEX.lit; // lit is unaffected by the normal-view alpha-gate bit
    f[4] = docW;
    f[5] = docH;
    f[6] = 1; // opacity (lit ignores it)
    u[7] = this.shapeCount;
    f[8] = p.lightDir[0];
    f[9] = p.lightDir[1];
    f[10] = p.lightDir[2];
    f[11] = p.normalXform.xx;
    f[12] = p.normalXform.xy;
    f[13] = p.normalXform.yx;
    f[14] = p.normalXform.yy;
    f[15] = p.lightEnergy;
    // point-light block at offset 64 (f[16]); 8 floats each. Fractions -> doc coords so lights scale with the doc.
    const maxDim = Math.max(docW, docH);
    for (let i = 0; i < 2; i++) {
      const pl = p.pointLights?.[i];
      if (!pl || !pl.on) continue; // leave the slot's 8 floats at 0 -> on=0 -> skipped in the shader
      const b = 16 + i * 8;
      f[b] = pl.x * docW;
      f[b + 1] = pl.y * docH;
      f[b + 2] = Math.max(1, pl.height * maxDim);
      f[b + 3] = pl.intensity;
      f[b + 4] = pl.color[0];
      f[b + 5] = pl.color[1];
      f[b + 6] = pl.color[2];
      f[b + 7] = 1;
    }
    this.device.queue.writeBuffer(this.boxUniforms, 0, ub);
    const bind = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.boxUniforms } },
        { binding: 1, resource: { buffer: this.recordsBuf } },
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
          view: this.ctx3d.getCurrentTexture().createView(),
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
    // this pass overwrote the box canvas with the lit composite; invalidate the 3D cache so switching
    // back to 3D re-renders immediately instead of leaving the stale lit frame up until the camera moves
    this.last3d = null;
  }

  private renderNow(docW: number, docH: number, p: PreviewParams): void {
    if (!this.diffuseTex) return;
    const probe = (globalThis as { __lambertPerf?: PerfProbe }).__lambertPerf;
    const t0 = probe ? performance.now() : 0;

    // pack the objects BOTH analytic passes evaluate (2D composite + 3D preview); re-pack only when the
    // layer tree changes
    let packMs = 0;
    if (p.layers !== this.lastShapes2d || p.defaults !== this.lastDefaults || !this.recordsBuf) {
      this.packObjectBuffers(flattenLayers(p.layers), p.defaults);
      this.lastShapes2d = p.layers;
      this.lastDefaults = p.defaults;
      this.packSeq++;
      if (probe) packMs = performance.now() - t0;
    }

    const dpr = this.canvas.width / (this.canvas.getBoundingClientRect().width || this.canvas.width) || 1;
    const ub = new ArrayBuffer(128); // 64 base + 64 point-light block (zero here — the editor never renders lit)
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

    // Fold cache: the composite snaps every fold sample to a doc-pixel centre, so a frame reads at
    // most (visible doc px + stencil) DISTINCT fold values — zoomed in, orders of magnitude fewer
    // than fragments. Fold those once into a doc-aligned window texture and let the cached
    // composite variant read it: pans, zoom-ins, and light/opacity/mode tweaks inside the apron
    // then cost zero fold work. Small docs fold WHOLE (valid at any zoom — samples are doc-px
    // centres regardless — and pan can never invalidate); big docs fold the visible window and
    // engage only at zoom >= 1, where the window is smaller than the screen. Diffuse mode never
    // folds, and big-doc zoom-outs keep the direct analytic path.
    const zoomDev = p.viewport.zoom * dpr;
    const fullDoc = (docW + 8) * (docH + 8) <= FOLD_FULL_DOC_TEXELS;
    let foldReady = false;
    if (!FOLD_CACHE_DISABLED && p.mode !== "diffuse" && (fullDoc || zoomDev >= 1)) {
      const vx0 = Math.max(Math.floor(-f[1] / zoomDev) - 4, -4);
      const vy0 = Math.max(Math.floor(-f[2] / zoomDev) - 4, -4);
      const vx1 = Math.min(Math.ceil((this.canvas.width - f[1]) / zoomDev) + 4, docW + 4);
      const vy1 = Math.min(Math.ceil((this.canvas.height - f[2]) / zoomDev) + 4, docH + 4);
      if (vx1 > vx0 && vy1 > vy0) {
        const c = this.foldCache;
        const hit =
          c !== null &&
          c.packSeq === this.packSeq &&
          c.detail === this.lastDetail &&
          c.docW === docW &&
          c.docH === docH &&
          vx0 >= c.x &&
          vy0 >= c.y &&
          vx1 <= c.x + c.w &&
          vy1 <= c.y + c.h;
        if (!hit) {
          const wx0 = fullDoc ? -4 : Math.max(vx0 - FOLD_APRON, -4);
          const wy0 = fullDoc ? -4 : Math.max(vy0 - FOLD_APRON, -4);
          const fw = (fullDoc ? docW + 4 : Math.min(vx1 + FOLD_APRON, docW + 4)) - wx0;
          const fh = (fullDoc ? docH + 4 : Math.min(vy1 + FOLD_APRON, docH + 4)) - wy0;
          if (!this.foldTex || this.foldTex.width !== fw || this.foldTex.height !== fh) {
            this.foldTex?.destroy();
            this.foldTex = this.device.createTexture({
              size: [fw, fh],
              format: "rg32float",
              usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
            });
          }
          const fub = new ArrayBuffer(32);
          const fu32 = new Uint32Array(fub);
          const ff32 = new Float32Array(fub);
          fu32[0] = fw;
          fu32[1] = fh;
          fu32[2] = this.shapeCount;
          ff32[3] = wx0;
          ff32[4] = wy0;
          ff32[5] = 1; // step: 1 doc px per texel
          this.device.queue.writeBuffer(this.foldUniforms, 0, fub);
          this.device.queue.writeBuffer(this.foldWinBuf, 0, new Float32Array([wx0, wy0, 0, 0]));
          const foldBind = this.device.createBindGroup({
            layout: this.foldPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: this.foldUniforms } },
              { binding: 1, resource: { buffer: this.recordsBuf! } },
              { binding: 2, resource: { buffer: this.pointsBuf! } },
              { binding: 3, resource: this.foldTex.createView() },
              { binding: 4, resource: { buffer: this.meshBuf! } },
              { binding: 6, resource: { buffer: this.maskLoopsBuf! } },
              { binding: 7, resource: { buffer: this.maskVertsBuf! } },
              { binding: 8, resource: { buffer: this.detailBuf! } },
            ],
          });
          const fenc = this.device.createCommandEncoder();
          const fpass = fenc.beginComputePass();
          fpass.setPipeline(this.foldPipeline);
          fpass.setBindGroup(0, foldBind);
          fpass.dispatchWorkgroups(Math.ceil(fw / 8), Math.ceil(fh / 8));
          fpass.end();
          this.device.queue.submit([fenc.finish()]);
          this.foldCache = { packSeq: this.packSeq, detail: this.lastDetail, docW, docH, x: wx0, y: wy0, w: fw, h: fh };
        }
        foldReady = true;
      }
    }

    const bind = foldReady
      ? this.device.createBindGroup({
          layout: this.compositeCachedPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniforms } },
            { binding: 5, resource: this.diffuseTex.createView() },
            { binding: 9, resource: this.foldTex!.createView() },
            { binding: 10, resource: { buffer: this.foldWinBuf } },
          ],
        })
      : this.device.createBindGroup({
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
    pass.setPipeline(foldReady ? this.compositeCachedPipeline : this.compositePipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    // box (3D inspection panel): draw its selected mode when the box is on (orbit3d present)
    if (p.orbit3d) {
      if (p.boxMode === "lit") this.renderLitToBox(docW, docH, p);
      else this.render3D(docW, docH, p);
    }
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
