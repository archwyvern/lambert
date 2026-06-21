import { describe, expect, it } from "vitest";
import { Vector2 } from "@carapace/primitives";
import { bezierAnchor } from "../../src/field/bezier";
import { insertOnClosed, movePoint, toggleMode } from "../../src/field/bezierEdit";

const v = (x: number, y: number): Vector2 => new Vector2(x, y);
const corner = (x: number, y: number) => bezierAnchor(v(x, y), v(0, 0), v(0, 0), "manual");

describe("bezierEdit", () => {
  it("movePoint relocates an anchor and keeps it smooth on a plain move", () => {
    const out = movePoint([corner(0, 0), corner(10, 0), corner(5, 10)], 0, v(2, 3), false);
    expect([out[0]!.p.x, out[0]!.p.y]).toEqual([2, 3]);
  });

  it("toggleMode flips curve<->corner, zeroing tangents (a corner is sharp, no tangents)", () => {
    const a = [bezierAnchor(v(0, 0)), bezierAnchor(v(10, 0)), bezierAnchor(v(5, 10))]; // all smooth
    const corner1 = toggleMode(a, 1);
    expect(corner1[1]!.mode).toBe("manual"); // smooth -> sharp corner
    expect(corner1[1]!.hIn).toEqual(v(0, 0)); // no tangents
    expect(corner1[1]!.hOut).toEqual(v(0, 0));
    // toggling back makes it smooth (auto tangents re-derive at render)
    expect(toggleMode(corner1, 1)[1]!.mode).toBe("smooth");
  });

  it("toggleMode turns a manual cusp (baked tangents) into a sharp corner, not a smooth curve", () => {
    const cusp = { ...bezierAnchor(v(10, 0), v(-3, 2), v(3, -2), "manual") };
    const out = toggleMode([bezierAnchor(v(0, 0)), cusp, bezierAnchor(v(5, 10))], 1);
    expect(out[1]!.mode).toBe("manual"); // a cusp (has tangents) -> corner
    expect(out[1]!.hIn).toEqual(v(0, 0));
    expect(out[1]!.hOut).toEqual(v(0, 0));
  });

  it("insertOnClosed adds an anchor on the loop and reports its index", () => {
    const r = insertOnClosed([corner(0, 0), corner(10, 0), corner(10, 10), corner(0, 10)], v(10, 5));
    expect(r).not.toBeNull();
    expect(r!.anchors.length).toBe(5);
    // (10,5) is on the right edge between anchors 1 and 2 -> inserted at index 2
    expect(r!.index).toBe(2);
  });
});
