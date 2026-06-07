import { combineHeight, influence } from "./combine";
import { getShapeType } from "./registry";
import { distanceScale, toLocal } from "./transform";
import type { ShapeInstance } from "./types";
import { mix, v2 } from "./vec";

export interface FieldResult {
  width: number;
  height: number;
  /** Height in px, row-major. */
  heightMap: Float32Array;
  /** Authored mask 0..1 (NX alpha), row-major. */
  mask: Float32Array;
}

/** Evaluate the ordered shape fold at every pixel center. The CPU reference implementation. */
export function evaluateField(shapes: ShapeInstance[], width: number, height: number): FieldResult {
  const heightMap = new Float32Array(width * height);
  const mask = new Float32Array(width * height);
  const resolved = shapes
    .filter((s) => s.visible)
    .map((s) => ({
      s,
      type: getShapeType(s.typeId),
      ds: distanceScale(s.transform),
      op: getShapeType(s.typeId).defaultCombine ?? ("max" as const),
    }));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = v2(x + 0.5, y + 0.5);
      let H = 0;
      let M = 0;
      for (const { s, type, ds, op } of resolved) {
        const sample = type.eval(toLocal(s.transform, p), s);
        const inf = influence(sample.sd * ds, s.combine.blend);
        if (inf <= 0) continue;
        const h = sample.height * s.transform.scale.z; // z scales tallness
        H = mix(H, combineHeight(op, H, h, s.combine.blend), inf);
        M = Math.max(M, inf);
      }
      const i = y * width + x;
      heightMap[i] = H;
      mask[i] = M;
    }
  }
  return { width, height, heightMap, mask };
}
