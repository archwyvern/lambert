import { downsampleRender, RenderResult, scaleShapesForSupersample } from "../render";
import type { ShapeInstance } from "../types";
import { packShapes } from "./pack";
import { buildFoldWgsl, buildNormalWgsl } from "./wgsl";

export const padRowBytes = (bytes: number): number => Math.ceil(bytes / 256) * 256;

export function deinterleaveField(
  raw: Float32Array,
  width: number,
  height: number,
  bytesPerRow: number,
): { heightMap: Float32Array; mask: Float32Array } {
  const rowFloats = bytesPerRow / 4;
  const heightMap = new Float32Array(width * height);
  const mask = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = y * rowFloats + x * 2;
      heightMap[y * width + x] = raw[src]!;
      mask[y * width + x] = raw[src + 1]!;
    }
  }
  return { heightMap, mask };
}

export function deinterleaveNormals(
  raw: Float32Array,
  width: number,
  height: number,
  bytesPerRow: number,
): { normals: Float32Array; mask: Float32Array } {
  const rowFloats = bytesPerRow / 4;
  const normals = new Float32Array(width * height * 3);
  const mask = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = y * rowFloats + x * 4;
      const o = y * width + x;
      normals[o * 3] = raw[src]!;
      normals[o * 3 + 1] = raw[src + 1]!;
      normals[o * 3 + 2] = raw[src + 2]!;
      mask[o] = raw[src + 3]!;
    }
  }
  return { normals, mask };
}

export interface GpuEvaluateOptions {
  supersample?: 1 | 2;
  /** Max tile edge in px for the hi-res evaluation. Small values exercise tiling in tests. */
  tileSize?: number;
}

const APRON = 1; // normal pass needs 1px neighborhood; tiles overlap by this and drop it

export class GpuFieldRenderer {
  private constructor(
    private readonly device: GPUDevice,
    private readonly foldPipeline: GPUComputePipeline,
    private readonly normalPipeline: GPUComputePipeline,
  ) {}

  static async create(device: GPUDevice): Promise<GpuFieldRenderer> {
    const foldModule = device.createShaderModule({ code: buildFoldWgsl() });
    const normalModule = device.createShaderModule({ code: buildNormalWgsl() });
    const [foldPipeline, normalPipeline] = await Promise.all([
      device.createComputePipelineAsync({ layout: "auto", compute: { module: foldModule, entryPoint: "fold" } }),
      device.createComputePipelineAsync({ layout: "auto", compute: { module: normalModule, entryPoint: "normals" } }),
    ]);
    return new GpuFieldRenderer(device, foldPipeline, normalPipeline);
  }

  /**
   * Evaluate one tile: fold + normals over [originX, originY, width, height] of the
   * conceptual canvas, returning dense arrays. slopeScale feeds the normal pass.
   */
  private async evaluateTile(
    packed: { records: Float32Array; points: Float32Array; meshTris: Float32Array; count: number },
    originX: number,
    originY: number,
    width: number,
    height: number,
    slopeScale: number,
  ): Promise<RenderResult> {
    const d = this.device;
    const fieldTex = d.createTexture({
      size: [width, height],
      format: "rg32float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const normalTex = d.createTexture({
      size: [width, height],
      format: "rgba32float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const uniforms = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const uniformData = new ArrayBuffer(32);
    const u32 = new Uint32Array(uniformData);
    const f32 = new Float32Array(uniformData);
    u32[0] = width;
    u32[1] = height;
    u32[2] = packed.count;
    f32[3] = originX;
    f32[4] = originY;
    f32[5] = 1; // step: doc-res tiles sample 1 doc px per output px
    d.queue.writeBuffer(uniforms, 0, uniformData);

    const recordsBuf = d.createBuffer({
      size: packed.records.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(recordsBuf, 0, packed.records);
    const pointsBuf = d.createBuffer({
      size: packed.points.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(pointsBuf, 0, packed.points);
    const meshBuf = d.createBuffer({
      size: packed.meshTris.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(meshBuf, 0, packed.meshTris);

    const normalUniforms = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const nu = new ArrayBuffer(16);
    new Uint32Array(nu).set([width, height], 0);
    new Float32Array(nu)[2] = slopeScale;
    d.queue.writeBuffer(normalUniforms, 0, nu);

    const foldBind = d.createBindGroup({
      layout: this.foldPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: { buffer: recordsBuf } },
        { binding: 2, resource: { buffer: pointsBuf } },
        { binding: 3, resource: fieldTex.createView() },
        { binding: 4, resource: { buffer: meshBuf } },
      ],
    });
    const normalBind = d.createBindGroup({
      layout: this.normalPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: normalUniforms } },
        { binding: 1, resource: fieldTex.createView() },
        { binding: 2, resource: normalTex.createView() },
      ],
    });

    const fieldRowBytes = padRowBytes(width * 8);
    const normalRowBytes = padRowBytes(width * 16);
    const fieldRead = d.createBuffer({
      size: fieldRowBytes * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const normalRead = d.createBuffer({
      size: normalRowBytes * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.foldPipeline);
    pass.setBindGroup(0, foldBind);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.setPipeline(this.normalPipeline);
    pass.setBindGroup(0, normalBind);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    enc.copyTextureToBuffer({ texture: fieldTex }, { buffer: fieldRead, bytesPerRow: fieldRowBytes }, [width, height]);
    enc.copyTextureToBuffer({ texture: normalTex }, { buffer: normalRead, bytesPerRow: normalRowBytes }, [width, height]);
    d.queue.submit([enc.finish()]);

    await Promise.all([fieldRead.mapAsync(GPUMapMode.READ), normalRead.mapAsync(GPUMapMode.READ)]);
    const { heightMap, mask } = deinterleaveField(
      new Float32Array(fieldRead.getMappedRange().slice(0)),
      width,
      height,
      fieldRowBytes,
    );
    const { normals } = deinterleaveNormals(
      new Float32Array(normalRead.getMappedRange().slice(0)),
      width,
      height,
      normalRowBytes,
    );
    fieldRead.unmap();
    normalRead.unmap();
    fieldTex.destroy();
    normalTex.destroy();
    for (const b of [uniforms, recordsBuf, pointsBuf, meshBuf, normalUniforms, fieldRead, normalRead]) b.destroy();
    return { width, height, heightMap, mask, normals };
  }

  /** Doc-res fold + normals into GPU textures, no readback. Consumed by the 3D preview pass. */
  renderToTextures(
    shapes: ShapeInstance[],
    width: number,
    height: number,
    existing?: { fieldTex: GPUTexture; normalTex: GPUTexture },
  ): { fieldTex: GPUTexture; normalTex: GPUTexture } {
    const d = this.device;
    const fieldTex =
      existing?.fieldTex ??
      d.createTexture({
        size: [width, height],
        format: "rg32float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    const normalTex =
      existing?.normalTex ??
      d.createTexture({
        size: [width, height],
        format: "rgba32float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    const packed = packShapes(shapes);

    const uniforms = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const ub = new ArrayBuffer(32);
    new Uint32Array(ub).set([width, height, packed.count], 0);
    new Float32Array(ub)[5] = 1; // step = 1: doc-res sampling (origin stays 0)
    d.queue.writeBuffer(uniforms, 0, ub);
    const recordsBuf = d.createBuffer({
      size: packed.records.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(recordsBuf, 0, packed.records);
    const pointsBuf = d.createBuffer({
      size: packed.points.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(pointsBuf, 0, packed.points);
    const meshBuf = d.createBuffer({
      size: packed.meshTris.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(meshBuf, 0, packed.meshTris);
    const normalUniforms = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const nb = new ArrayBuffer(16);
    new Uint32Array(nb).set([width, height], 0);
    new Float32Array(nb)[2] = 1; // slopeScale
    d.queue.writeBuffer(normalUniforms, 0, nb);

    const foldBind = d.createBindGroup({
      layout: this.foldPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: { buffer: recordsBuf } },
        { binding: 2, resource: { buffer: pointsBuf } },
        { binding: 3, resource: fieldTex.createView() },
        { binding: 4, resource: { buffer: meshBuf } },
      ],
    });
    const normalBind = d.createBindGroup({
      layout: this.normalPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: normalUniforms } },
        { binding: 1, resource: fieldTex.createView() },
        { binding: 2, resource: normalTex.createView() },
      ],
    });
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.foldPipeline);
    pass.setBindGroup(0, foldBind);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.setPipeline(this.normalPipeline);
    pass.setBindGroup(0, normalBind);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    d.queue.submit([enc.finish()]);
    for (const b of [uniforms, recordsBuf, pointsBuf, meshBuf, normalUniforms]) b.destroy();
    return { fieldTex, normalTex };
  }

  /**
   * Full evaluate matching renderField() semantics: optional 2x supersample (shapes scaled,
   * slopeScale-corrected normals, shared CPU downsample), tiled so 8K x ss2 fits in VRAM.
   * Tiles carry a 1px apron so the normal pass sees true neighbors at interior seams.
   * Canvas-border pixels clamp identically to the CPU reference.
   */
  async evaluate(
    shapes: ShapeInstance[],
    width: number,
    height: number,
    opts: GpuEvaluateOptions = {},
  ): Promise<RenderResult> {
    const f = opts.supersample ?? 1;
    const tileSize = opts.tileSize ?? 2048;
    const hiW = width * f;
    const hiH = height * f;
    const packed = packShapes(f === 1 ? shapes : scaleShapesForSupersample(shapes, f));

    const hiHeight = new Float32Array(hiW * hiH);
    const hiMask = new Float32Array(hiW * hiH);
    const hiNormals = new Float32Array(hiW * hiH * 3);

    for (let ty = 0; ty < hiH; ty += tileSize) {
      for (let tx = 0; tx < hiW; tx += tileSize) {
        const tw = Math.min(tileSize, hiW - tx);
        const th = Math.min(tileSize, hiH - ty);
        // expand by apron, clamped to the canvas (border pixels clamp like the CPU does)
        const ax = Math.max(0, tx - APRON);
        const ay = Math.max(0, ty - APRON);
        const aw = Math.min(hiW, tx + tw + APRON) - ax;
        const ah = Math.min(hiH, ty + th + APRON) - ay;
        const tile = await this.evaluateTile(packed, ax, ay, aw, ah, f);
        // copy the interior (drop apron)
        const ox = tx - ax;
        const oy = ty - ay;
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const src = (y + oy) * aw + (x + ox);
            const dst = (ty + y) * hiW + (tx + x);
            hiHeight[dst] = tile.heightMap[src]!;
            hiMask[dst] = tile.mask[src]!;
            hiNormals[dst * 3] = tile.normals[src * 3]!;
            hiNormals[dst * 3 + 1] = tile.normals[src * 3 + 1]!;
            hiNormals[dst * 3 + 2] = tile.normals[src * 3 + 2]!;
          }
        }
      }
    }

    if (f === 1) return { width, height, heightMap: hiHeight, mask: hiMask, normals: hiNormals };
    return downsampleRender({ width: hiW, height: hiH, heightMap: hiHeight, mask: hiMask }, hiNormals, f);
  }
}
