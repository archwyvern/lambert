import { meshGradients } from "../meshOps";
import { getShapeType } from "../registry";
import { distanceScale } from "../transform";
import type { ShapeInstance } from "../types";
import { gpuTypeIndex, MAX_PARAMS, PARAMS_OFFSET, RECORD_F32 } from "./wgsl";



export interface PackedShapes {
  records: Float32Array;
  /** Flattened vec2 control points (x,y pairs). */
  points: Float32Array;
  /** Mesh triangles as vec4 (local x,y,z,pad), 3 per triangle, for the mesh shape. */
  meshTris: Float32Array;
  count: number;
}

/**
 * Pack visible shapes into the storage-buffer record layout consumed by buildFoldWgsl().
 * Params pack in declaration order; enums as option index. WebGPU forbids zero-size
 * bindings, so empty lists still allocate one zeroed record/point.
 */
export function packShapes(shapes: ShapeInstance[]): PackedShapes {
  const visible = shapes.filter((s) => s.visible);
  const totalPoints = visible.reduce((n, s) => n + s.controlPoints.length, 0);
  const totalTris = visible.reduce((n, s) => n + (s.mesh?.tris.length ?? 0), 0);
  const records = new Float32Array(Math.max(visible.length, 1) * RECORD_F32);
  const points = new Float32Array(Math.max(totalPoints, 1) * 2);
  const meshTris = new Float32Array(Math.max(totalTris * 6, 1) * 4); // 2 vec4/vert (pos+grad), 3 verts/tri

  let cpStart = 0;
  let triVec4 = 0; // running vec4 index into meshTris
  visible.forEach((s, si) => {
    const type = getShapeType(s.typeId);
    const base = si * RECORD_F32;
    records[base] = gpuTypeIndex(s.typeId);
    records[base + 1] = type.defaultCombine === "carve" ? 1 : 0; // op lives on the type
    records[base + 3] = s.transform.scale.z; // extrude multiplier (tallness scale)
    records[base + 21] = s.transform.pos.z; // base elevation (post-extrude add)
    records[base + 4] = s.transform.pos.x;
    records[base + 5] = s.transform.pos.y;
    records[base + 6] = Math.cos(-s.transform.rotation);
    records[base + 7] = Math.sin(-s.transform.rotation);
    records[base + 8] = 1 / s.transform.scale.x;
    records[base + 9] = 1 / s.transform.scale.y;
    records[base + 10] = distanceScale(s.transform);
    records[base + 11] = cpStart;
    records[base + 12] = s.controlPoints.length;
    records[base + 2] = s.ringSplit ?? (s.controlPoints.length >> 1); // base-ring count (rings shapes)
    const paramKeys = Object.entries(type.params);
    if (paramKeys.length > MAX_PARAMS) throw new Error(`${s.typeId}: too many params for record`);
    paramKeys.forEach(([key, spec], pi) => {
      const value = s.params[key];
      if (spec.type === "enum") {
        const idx = spec.options.indexOf(String(value));
        if (idx < 0) throw new Error(`${s.typeId}.${key}: unknown enum value ${String(value)}`);
        records[base + PARAMS_OFFSET + pi] = idx;
      } else {
        if (typeof value !== "number") throw new Error(`${s.typeId}.${key}: expected number`);
        records[base + PARAMS_OFFSET + pi] = value;
      }
    });
    for (const cp of s.controlPoints) {
      points[cpStart * 2] = cp.x;
      points[cpStart * 2 + 1] = cp.y;
      cpStart++;
    }
    if (s.mesh) {
      const grad = meshGradients(s.controlPoints, s.mesh.z, s.mesh.tris);
      records[base + 22] = triVec4; // first vec4 of this mesh's triangles
      records[base + 23] = s.mesh.tris.length;
      for (const tri of s.mesh.tris) {
        for (const idx of tri) {
          const cp = s.controlPoints[idx]!;
          const g = grad[idx]!;
          meshTris[triVec4 * 4] = cp.x;
          meshTris[triVec4 * 4 + 1] = cp.y;
          meshTris[triVec4 * 4 + 2] = s.mesh.z[idx]!;
          meshTris[triVec4 * 4 + 3] = g[0]; // gradX
          triVec4++;
          meshTris[triVec4 * 4] = g[1]; // gradY in the next vec4's .x
          triVec4++;
        }
      }
    }
  });
  return { records, points, meshTris, count: visible.length };
}
