import { expect, test } from "vitest";
import { canvasToScreen, fitViewport, screenToCanvas, zoomAt } from "../../src/ui/viewport";
import { v2 } from "../../src/field/vec";

test("round-trips screen<->canvas", () => {
  const v = { zoom: 2, panX: 100, panY: 50 };
  const s = canvasToScreen(v, v2(10, 20));
  expect(s).toEqual({ x: 120, y: 90 });
  expect(screenToCanvas(v, s)).toEqual({ x: 10, y: 20 });
});

test("zoomAt keeps the anchor point fixed on screen", () => {
  const v = { zoom: 1, panX: 0, panY: 0 };
  const anchor = v2(300, 200);
  const before = screenToCanvas(v, anchor);
  const z = zoomAt(v, anchor, 2);
  expect(z.zoom).toBe(2);
  const after = screenToCanvas(z, anchor);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});

test("zoomAt clamps to [0.125, 16]", () => {
  const v = { zoom: 16, panX: 0, panY: 0 };
  expect(zoomAt(v, v2(0, 0),4).zoom).toBe(16);
  expect(zoomAt({ ...v, zoom: 0.125 }, v2(0, 0),0.5).zoom).toBe(0.125);
});

test("fitViewport centers the canvas with margin", () => {
  const v = fitViewport(100, 50, 1000, 500, 25);
  // scale limited by height: (500-50)/50 = 9; width allows (1000-50)/100 = 9.5
  expect(v.zoom).toBe(9);
  expect(canvasToScreen(v, v2(50, 25))).toEqual({ x: 500, y: 250 }); // canvas center -> view center
});
