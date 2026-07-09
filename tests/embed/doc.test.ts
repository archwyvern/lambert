import { describe, it, expect } from "vitest";
import { encode } from "fast-png";
import { buildEmbedDoc, serializeEmbedDoc } from "../../src/embed/doc";

const png = (w: number, h: number): Uint8Array => encode({ width: w, height: h, data: new Uint8Array(w * h * 4) });

describe("embed doc construction", () => {
  it("builds an empty doc sized to the diffuse when there is no initial doc", () => {
    const doc = buildEmbedDoc(png(12, 7), null);
    expect(doc.source.width).toBe(12);
    expect(doc.source.height).toBe(7);
    expect(doc.layers).toEqual([]);
  });

  it("round-trips a document through save and reload (the host stores opaque JSON)", () => {
    const first = buildEmbedDoc(png(8, 8), null);
    const saved: unknown = serializeEmbedDoc(first); // what the host persists
    // a plain JSON object survives a structured-clone-ish trip, as it would through a DB column
    const throughStore = JSON.parse(JSON.stringify(saved));
    const reloaded = buildEmbedDoc(png(8, 8), throughStore);
    expect(reloaded.source.width).toBe(8);
    expect(reloaded.source.height).toBe(8);
  });

  it("accepts an initial doc as a raw string too (parseDoc's native form)", () => {
    const first = buildEmbedDoc(png(5, 9), null);
    const asString = JSON.stringify(serializeEmbedDoc(first));
    const reloaded = buildEmbedDoc(png(5, 9), asString);
    expect(reloaded.source.height).toBe(9);
  });
});
