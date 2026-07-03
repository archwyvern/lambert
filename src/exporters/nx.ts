import { encode } from "fast-png";
import { DEFAULT_OUTPUT, NormalDirs, normalXform, OutputSettings } from "../document/schema";
import { encodeExr, type ExrChannel } from "./exr";
import { encodeRadianceHdr } from "./hdr";
import { q16, q8 } from "./normalmap";

/** The semantic channel planes every NX container draws from, as floats in [0, 1]. Kept at double
 *  precision so the PNG quantization is bit-identical to the historical encode (float32
 *  intermediates shift q16 by ±1). */
function nxPlanes(
  normals: Float32Array,
  mask: Float32Array,
  n: number,
  dirs: NormalDirs,
  opaque?: Uint8Array | null,
): { r: Float64Array; g: Float64Array; b: Float64Array; a: Float64Array } {
  const m = normalXform(dirs); // channel signs + the encoded-frame rotation
  const r = new Float64Array(n);
  const g = new Float64Array(n);
  const b = new Float64Array(n);
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nx = normals[i * 3]!;
    const ny = normals[i * 3 + 1]!;
    r[i] = 0.5 + (m.xx * nx + m.xy * ny) / 2;
    g[i] = 0.5 + (m.yx * nx + m.yy * ny) / 2;
    b[i] = normals[i * 3 + 2]!; // NX contract: blue is FULL-range z
    // the override only applies where the diffuse has a pixel (A > 0) — clear the mask elsewhere
    a[i] = opaque && opaque[i] === 0 ? 0 : mask[i]!;
  }
  return { r, g, b, a };
}

/** Layout -> which semantic planes ship, in container-channel order. */
const LAYOUTS: Record<OutputSettings["channels"], Array<"r" | "g" | "b" | "a">> = {
  rgba: ["r", "g", "b", "a"],
  rgb: ["r", "g", "b"],
  rg: ["r", "g"],
  rga: ["r", "g", "a"], // XY + the alpha gate in the third slot
};

/** EXR channel names for each semantic plane. */
const EXR_NAMES: Record<"r" | "g" | "b" | "a", string> = { r: "R", g: "G", b: "B", a: "A" };

/**
 * Skyrat NX override encode, generalized over the project/document output settings: channel layout
 * (rgba/rgb/rg/rga), bit depth (PNG 8/16), and container (png/exr/hdr). The default settings are
 * the historical contract — 16-bit RGBA PNG (65535 levels/channel so smooth gradients don't band).
 * Channel directions follow NormalDirs (default red-right green-up). Blue is FULL-range z. Alpha =
 * authored mask (override only applies where alpha > 0). NOTE the Skyrat reader must normalize by
 * the depth: x=2(r/65535-.5), y=2(.5-g/65535), z=b/65535.
 */
export function encodeNx(
  normals: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  dirs: NormalDirs,
  opaque: Uint8Array | null | undefined,
  output: OutputSettings,
): Uint8Array {
  const n = width * height;
  const planes = nxPlanes(normals, mask, n, dirs, opaque);
  const layout = LAYOUTS[output.channels];

  if (output.format === "exr") {
    // float32 scanline EXR — bit depth doesn't apply
    const channels: ExrChannel[] = layout.map((k) => ({ name: EXR_NAMES[k], data: new Float32Array(planes[k]) }));
    return encodeExr(width, height, channels);
  }
  if (output.format === "hdr") {
    // RGBE shares one exponent across exactly three mantissas — only the rgb layout fits
    if (output.channels !== "rgb") {
      throw new Error(`Radiance HDR only supports the RGB channel layout (output is "${output.channels}")`);
    }
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = planes.r[i]!;
      rgb[i * 3 + 1] = planes.g[i]!;
      rgb[i * 3 + 2] = planes.b[i]!;
    }
    return encodeRadianceHdr(width, height, rgb);
  }

  // PNG at 8 or 16 bits with the layout's channel count. A 2-channel PNG is nominally
  // grayscale+alpha; the NX contract reads it as raw X,Y planes.
  const cn = layout.length;
  if (output.depth === 16) {
    const data = new Uint16Array(n * cn);
    for (let i = 0; i < n; i++) for (let c = 0; c < cn; c++) data[i * cn + c] = q16(planes[layout[c]!][i]!);
    return encode({ width, height, data, depth: 16, channels: cn });
  }
  const data = new Uint8Array(n * cn);
  for (let i = 0; i < n; i++) for (let c = 0; c < cn; c++) data[i * cn + c] = q8(planes[layout[c]!][i]!);
  return encode({ width, height, data, depth: 8, channels: cn });
}

/** The historical NX encode (16-bit RGBA PNG) — the golden-fixture contract. */
export function encodeNxPng(
  normals: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  dirs: NormalDirs,
  opaque?: Uint8Array | null,
): Uint8Array {
  return encodeNx(normals, mask, width, height, dirs, opaque, DEFAULT_OUTPUT);
}

/** Per-pixel opacity flags (1 = A>0, 0 = transparent) from a decoded image; null if no alpha channel. */
export function diffuseOpacity(img: {
  width: number;
  height: number;
  data: ArrayLike<number>;
  channels: number;
}): Uint8Array | null {
  if (img.channels !== 2 && img.channels !== 4) return null; // grayscale / RGB: no alpha = fully opaque
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = img.data[i * img.channels + (img.channels - 1)]! > 0 ? 1 : 0;
  return out;
}
