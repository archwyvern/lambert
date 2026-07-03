/**
 * Radiance HDR (RGBE) writer with new-style adaptive-RLE scanlines — the standard encoding every
 * reader expects for widths in [8, 32767]. RGB only: RGBE shares one exponent across the three
 * mantissas and has no alpha, so only the `rgb` channel layout can ship in this container.
 */

/** float RGB -> shared-exponent RGBE bytes. */
export function toRgbe(r: number, g: number, b: number): [number, number, number, number] {
  const v = Math.max(r, g, b);
  if (v < 1e-32) return [0, 0, 0, 0];
  // frexp: v = f * 2^e with f in [0.5, 1)
  let e = Math.ceil(Math.log2(v));
  if (v / 2 ** e >= 1) e += 1; // log2 rounding at exact powers of two
  const scale = 256 / 2 ** e;
  return [
    Math.min(255, Math.floor(r * scale)),
    Math.min(255, Math.floor(g * scale)),
    Math.min(255, Math.floor(b * scale)),
    e + 128,
  ];
}

/** RLE one component plane of a scanline: runs >= 4 as [128+len, value], else literals [len, ...]. */
function rlePlane(plane: Uint8Array, out: number[]): void {
  const n = plane.length;
  let i = 0;
  while (i < n) {
    // find the next run of >= 4 identical bytes
    let runStart = i;
    while (runStart < n) {
      let runLen = 1;
      while (runStart + runLen < n && runLen < 127 && plane[runStart + runLen] === plane[runStart]) runLen++;
      if (runLen >= 4) break;
      runStart += runLen;
    }
    // literals up to the run (chunks of <= 128)
    let lit = i;
    while (lit < Math.min(runStart, n)) {
      const len = Math.min(128, runStart - lit);
      out.push(len);
      for (let k = 0; k < len; k++) out.push(plane[lit + k]!);
      lit += len;
    }
    i = Math.min(runStart, n);
    if (i < n) {
      // emit the run
      let runLen = 1;
      while (i + runLen < n && runLen < 127 && plane[i + runLen] === plane[i]) runLen++;
      out.push(128 + runLen, plane[i]!);
      i += runLen;
    }
  }
}

/** Encode float RGB (3 floats per pixel, row-major, values >= 0) as a Radiance .hdr file. */
export function encodeRadianceHdr(width: number, height: number, rgb: Float32Array): Uint8Array {
  if (rgb.length !== width * height * 3) throw new Error(`rgb has ${rgb.length} floats, expected ${width * height * 3}`);
  if (width < 8 || width > 32767) throw new Error(`Radiance RLE needs width in [8, 32767], got ${width}`);
  const header = `#?RADIANCE\n# Written by Lambert\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const out: number[] = [...new TextEncoder().encode(header)];
  const planes = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const [r, g, b, e] = toRgbe(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!);
      planes[0]![x] = r;
      planes[1]![x] = g;
      planes[2]![x] = b;
      planes[3]![x] = e;
    }
    out.push(2, 2, (width >> 8) & 0xff, width & 0xff); // new-style scanline marker
    for (const p of planes) rlePlane(p, out);
  }
  return new Uint8Array(out);
}
