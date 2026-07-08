import type { AdjustmentDefaults } from "../adjustments";
import type { DetailField } from "../detail";
import type { ResolvedObject } from "../flatten";
import { downsampleRender, RenderResult, scaleResolvedForSupersample } from "../render";
import { packObjects, type PackedObjects } from "./pack";
import { buildFoldWgsl, buildNormalWgsl } from "./wgsl";

export const padRowBytes = (bytes: number): number => Math.ceil(bytes / 256) * 256;

/** The five fold-stage storage buffers, uploaded from a packed object stream. */
interface PackedBuffers {
  records: GPUBuffer;
  points: GPUBuffer;
  mesh: GPUBuffer;
  maskLoops: GPUBuffer;
  maskVerts: GPUBuffer;
}

const storageBuffer = (d: GPUDevice, data: ArrayBufferView): GPUBuffer => {
  const buf = d.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  d.queue.writeBuffer(buf, 0, data);
  return buf;
};

/** The detail-band storage buffer: header vec4(w, h, scale, 0) + w*h band texels (or just a zero
 *  header when there is no detail — the WGSL sampler returns 0 for a zero header). */
export const detailBuffer = (d: GPUDevice, detail: DetailField | null | undefined, scale: number): GPUBuffer => {
  if (!detail) return storageBuffer(d, new Float32Array(4));
  const data = new Float32Array(4 + detail.data.length);
  data[0] = detail.width;
  data[1] = detail.height;
  // header scale = eval-space -> texel: the caller's eval scale composed with the field's own
  // doc-px -> texel scale (1 full res, <1 for a progressive preview field)
  data[2] = scale * detail.scale;
  data.set(detail.data, 4);
  return storageBuffer(d, data);
};

/** Upload the packed object stream into the five fold storage buffers. */
const uploadPacked = (d: GPUDevice, packed: PackedObjects): PackedBuffers => ({
  records: storageBuffer(d, packed.records),
  points: storageBuffer(d, packed.points),
  mesh: storageBuffer(d, packed.meshTris),
  maskLoops: storageBuffer(d, packed.maskLoops),
  maskVerts: storageBuffer(d, packed.maskVerts),
});

/** Fold compute-pass bind group: uniforms + the packed buffers + the field output texture. */
const foldBindGroup = (d: GPUDevice, pipeline: GPUComputePipeline, uniforms: GPUBuffer, bufs: PackedBuffers, fieldTex: GPUTexture, detail: GPUBuffer): GPUBindGroup =>
  d.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: bufs.records } },
      { binding: 2, resource: { buffer: bufs.points } },
      { binding: 3, resource: fieldTex.createView() },
      { binding: 4, resource: { buffer: bufs.mesh } },
      { binding: 6, resource: { buffer: bufs.maskLoops } },
      { binding: 7, resource: { buffer: bufs.maskVerts } },
      { binding: 8, resource: { buffer: detail } },
    ],
  });

/** Normal-derivation compute-pass bind group: its uniforms + field input + normal output. */
const normalBindGroup = (d: GPUDevice, pipeline: GPUComputePipeline, uniforms: GPUBuffer, fieldTex: GPUTexture, normalTex: GPUTexture): GPUBindGroup =>
  d.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: fieldTex.createView() },
      { binding: 2, resource: normalTex.createView() },
    ],
  });

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
  /** The Emboss/Detail bands (doc-res); absent = a zero header (samples return 0). */
  detail?: DetailField | null;
  /** Project default params for inheriting adjustment entries (absent = factory defaults). */
  defaults?: AdjustmentDefaults;
}

const APRON = 2; // the normal pass's side_grad stencil reads ±2px; tiles overlap by this and drop it

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
    packed: {
      records: Float32Array;
      points: Float32Array;
      meshTris: Float32Array;
      maskLoops: Float32Array;
      maskVerts: Float32Array;
      count: number;
    },
    originX: number,
    originY: number,
    width: number,
    height: number,
    slopeScale: number,
    detailBuf: GPUBuffer,
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

    const bufs = uploadPacked(d, packed);

    const normalUniforms = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const nu = new ArrayBuffer(16);
    new Uint32Array(nu).set([width, height], 0);
    new Float32Array(nu)[2] = slopeScale;
    d.queue.writeBuffer(normalUniforms, 0, nu);

    const foldBind = foldBindGroup(d, this.foldPipeline, uniforms, bufs, fieldTex, detailBuf);
    const normalBind = normalBindGroup(d, this.normalPipeline, normalUniforms, fieldTex, normalTex);

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
    for (const b of [uniforms, bufs.records, bufs.points, bufs.mesh, bufs.maskLoops, bufs.maskVerts, normalUniforms, fieldRead, normalRead]) b.destroy();
    return { width, height, heightMap, mask, normals };
  }

  /**
   * Full evaluate matching renderField() semantics: optional 2x supersample (objects scaled,
   * slopeScale-corrected normals, shared CPU downsample), tiled so 8K x ss2 fits in VRAM.
   * Tiles carry a 1px apron so the normal pass sees true neighbors at interior seams.
   * Canvas-border pixels clamp identically to the CPU reference.
   */
  async evaluate(
    resolved: ResolvedObject[],
    width: number,
    height: number,
    opts: GpuEvaluateOptions = {},
  ): Promise<RenderResult> {
    const f = opts.supersample ?? 1;
    const tileSize = opts.tileSize ?? 2048;
    const hiW = width * f;
    const hiH = height * f;
    const packed = packObjects(f === 1 ? resolved : scaleResolvedForSupersample(resolved, f), opts.defaults);
    // the detail bands sample in DOC space: scale maps the hi-res eval space back to detail texels
    const detailBuf = detailBuffer(this.device, opts.detail, 1 / f);

    // Guard the transient hi-res heap before allocating: hiHeight + hiMask + hiNormals = 5 floats/px ×
    // 4 B = 20 B/px. An 8192² source at ss2 is 16384² ≈ 268M px ≈ 5.4 GB and OOM-crashes the renderer
    // mid-export — fail with a clear, actionable error instead. (~150M px ≈ 3 GB ceiling; real diffuses
    // are far smaller, so this only ever trips on a pathological source.)
    const hiPixels = hiW * hiH;
    const MAX_HI_PIXELS = 150_000_000;
    if (hiPixels > MAX_HI_PIXELS) {
      throw new Error(
        `Export too large: ${width}×${height}${f > 1 ? ` at ${f}× supersample` : ""} = ${hiW}×${hiH} working ` +
          `pixels exceeds the limit (~${Math.round((hiPixels * 20) / 1e9)} GB needed). Reduce the source size or supersample.`,
      );
    }

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
        const tile = await this.evaluateTile(packed, ax, ay, aw, ah, f, detailBuf);
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

    detailBuf.destroy();
    if (f === 1) return { width, height, heightMap: hiHeight, mask: hiMask, normals: hiNormals };
    return downsampleRender({ width: hiW, height: hiH, heightMap: hiHeight, mask: hiMask }, hiNormals, f);
  }
}
