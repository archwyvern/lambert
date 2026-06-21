import { describe, expect, it } from "vitest";
import { emptyDoc, parseDoc, serializeDoc } from "../../src/document/schema";

describe("doc.canvas", () => {
  it("emptyDoc seeds origin at the centre", () => {
    const d = emptyDoc("a.png", 100, 60);
    expect(d.canvas.origin).toEqual({ x: 50, y: 30 });
    expect(d.canvas.guides).toEqual([]);
    expect(d.canvas.guidesLocked).toBe(false);
    expect(d.canvas.snapToGuides).toBe(false);
  });

  it("legacy doc without canvas defaults origin to centre", () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      source: { path: "a.png", width: 80, height: 40 },
      shapes: [],
    });
    expect(parseDoc(legacy).canvas.origin).toEqual({ x: 40, y: 20 });
  });

  it("canvas round-trips (origin + guides + flags)", () => {
    const d = emptyDoc("a.png", 64, 64);
    d.canvas = {
      origin: { x: 10, y: 20 },
      guides: [
        { orient: "v", at: 12 },
        { orient: "h", at: 30 },
      ],
      guidesLocked: true,
      snapToGuides: true,
    };
    const back = parseDoc(serializeDoc(d));
    expect(back.canvas).toEqual(d.canvas);
  });
});
