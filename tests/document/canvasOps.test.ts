import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/document/schema";
import { addGuide, clearGuides, moveGuide, removeGuide } from "../../src/document/canvasOps";

describe("guide ops", () => {
  it("addGuide appends without mutating the source doc", () => {
    const d0 = emptyDoc("a.png", 64, 64);
    const d1 = addGuide(d0, { orient: "v", at: 12 });
    expect(d0.canvas.guides).toEqual([]);
    expect(d1.canvas.guides).toEqual([{ orient: "v", at: 12 }]);
  });

  it("moveGuide repositions one guide only", () => {
    let d = emptyDoc("a.png", 64, 64);
    d = addGuide(d, { orient: "v", at: 12 });
    d = addGuide(d, { orient: "h", at: 30 });
    d = moveGuide(d, 1, 40);
    expect(d.canvas.guides).toEqual([
      { orient: "v", at: 12 },
      { orient: "h", at: 40 },
    ]);
  });

  it("removeGuide drops the indexed guide", () => {
    let d = emptyDoc("a.png", 64, 64);
    d = addGuide(d, { orient: "v", at: 12 });
    d = addGuide(d, { orient: "h", at: 30 });
    d = removeGuide(d, 0);
    expect(d.canvas.guides).toEqual([{ orient: "h", at: 30 }]);
  });

  it("clearGuides empties the list", () => {
    let d = emptyDoc("a.png", 64, 64);
    d = addGuide(d, { orient: "v", at: 12 });
    d = clearGuides(d);
    expect(d.canvas.guides).toEqual([]);
  });
});
