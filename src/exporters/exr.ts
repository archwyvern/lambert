/**
 * Minimal OpenEXR writer: single-part, scanline, UNCOMPRESSED, float32 channels. Small and
 * dependency-free on purpose — the reader side is any DCC/engine tool, which all accept
 * uncompressed float scanline EXR. Channels are stored alphabetically as the format requires.
 */

export interface ExrChannel {
  /** Channel name ("R", "G", "B", "A"). */
  name: string;
  /** One float per pixel, row-major. */
  data: Float32Array;
}

const FLOAT = 2; // pixelType: 0=UINT, 1=HALF, 2=FLOAT

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private scratch = new DataView(new ArrayBuffer(8));

  bytes(...vals: number[]): void {
    this.chunks.push(new Uint8Array(vals));
  }

  raw(a: Uint8Array): void {
    this.chunks.push(a);
  }

  str(s: string): void {
    this.raw(new TextEncoder().encode(s + "\0"));
  }

  i32(v: number): void {
    this.scratch.setInt32(0, v, true);
    this.raw(new Uint8Array(this.scratch.buffer.slice(0, 4)));
  }

  u64(v: number): void {
    this.scratch.setBigUint64(0, BigInt(v), true);
    this.raw(new Uint8Array(this.scratch.buffer.slice(0, 8)));
  }

  f32(v: number): void {
    this.scratch.setFloat32(0, v, true);
    this.raw(new Uint8Array(this.scratch.buffer.slice(0, 4)));
  }

  size(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0);
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.size());
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/** An attribute: name, type, then the payload length + bytes. */
function attr(w: ByteWriter, name: string, type: string, write: (b: ByteWriter) => void): void {
  const body = new ByteWriter();
  write(body);
  w.str(name);
  w.str(type);
  w.i32(body.size());
  w.raw(body.concat());
}

export function encodeExr(width: number, height: number, channels: ExrChannel[]): Uint8Array {
  const chans = [...channels].sort((a, b) => (a.name < b.name ? -1 : 1)); // format requires alphabetical
  for (const c of chans) {
    if (c.data.length !== width * height) throw new Error(`channel ${c.name} has ${c.data.length} px, expected ${width * height}`);
  }

  const w = new ByteWriter();
  w.bytes(0x76, 0x2f, 0x31, 0x01); // magic
  w.bytes(2, 0, 0, 0); // version 2, no flags (single-part scanline)

  attr(w, "channels", "chlist", (b) => {
    for (const c of chans) {
      b.str(c.name);
      b.i32(FLOAT);
      b.bytes(0, 0, 0, 0); // pLinear + reserved
      b.i32(1); // xSampling
      b.i32(1); // ySampling
    }
    b.bytes(0); // terminator
  });
  attr(w, "compression", "compression", (b) => b.bytes(0)); // none
  attr(w, "dataWindow", "box2i", (b) => {
    b.i32(0);
    b.i32(0);
    b.i32(width - 1);
    b.i32(height - 1);
  });
  attr(w, "displayWindow", "box2i", (b) => {
    b.i32(0);
    b.i32(0);
    b.i32(width - 1);
    b.i32(height - 1);
  });
  attr(w, "lineOrder", "lineOrder", (b) => b.bytes(0)); // increasing y
  attr(w, "pixelAspectRatio", "float", (b) => b.f32(1));
  attr(w, "screenWindowCenter", "v2f", (b) => {
    b.f32(0);
    b.f32(0);
  });
  attr(w, "screenWindowWidth", "float", (b) => b.f32(1));
  w.bytes(0); // end of header

  // scanline offset table (absolute file offsets), then the scanline blocks
  const rowData = chans.length * width * 4;
  const blockSize = 4 + 4 + rowData; // y + size + pixels
  const tableStart = w.size();
  const dataStart = tableStart + height * 8;
  for (let y = 0; y < height; y++) w.u64(dataStart + y * blockSize);

  for (let y = 0; y < height; y++) {
    w.i32(y);
    w.i32(rowData);
    const row = new DataView(new ArrayBuffer(rowData));
    let o = 0;
    for (const c of chans) {
      for (let x = 0; x < width; x++, o += 4) row.setFloat32(o, c.data[y * width + x]!, true);
    }
    w.raw(new Uint8Array(row.buffer));
  }
  return w.concat();
}
