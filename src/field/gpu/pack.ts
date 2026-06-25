import { bakeMaskLoop, resolveHandles, resolveHandlesClosed } from "../bezier";
import type { ResolvedObject } from "../flatten";
import { meshGradients } from "../meshOps";
import { getObjectType } from "../registry";
import { gpuTypeIndex, MAX_PARAMS, PARAMS_OFFSET, RECORD_F32 } from "./wgsl";



export interface PackedObjects {
  records: Float32Array;
  /** Flattened vec2 control points (x,y pairs). */
  points: Float32Array;
  /** Mesh triangles as vec4 (local x,y,z,pad), 3 per triangle, for the mesh object. */
  meshTris: Float32Array;
  /** Mask loop headers as vec4 (vertStart, vertCount, flags, scopeId), one per loop. */
  maskLoops: Float32Array;
  /** Flattened vec2 mask loop vertices (baked closed polygons). */
  maskVerts: Float32Array;
  count: number;
}

/**
 * Pack resolved (flattened, world-transformed) objects into the storage-buffer record layout consumed
 * by buildFoldWgsl(). Group composition + visibility are already applied by flattenLayers. Params
 * pack in declaration order; enums as option index. WebGPU forbids zero-size bindings, so empty
 * lists still allocate one zeroed record/point.
 */
export function packObjects(resolved: ResolvedObject[]): PackedObjects {
  const visible = resolved; // flatten already dropped hidden subtrees
  // A vector that evaluates its Bézier ANALYTICALLY (cable) packs 3 vec2 per anchor (p, hIn, hOut) and
  // has no baked controlPoints. Every other object packs its controlPoints — including vectors whose
  // Bézier path is BAKED to a dense controlPoints polyline/polygon (the bezier stays as the edit source
  // but the field math walks the baked points). So: pack anchors only when there are no controlPoints.
  const analytic = (s: { bezier?: unknown[]; controlPoints: unknown[] }): boolean => !!s.bezier && s.controlPoints.length === 0;
  const totalPoints = visible.reduce((n, { object: s }) => n + (analytic(s) ? s.bezier!.length * 4 : s.controlPoints.length), 0);
  const totalTris = visible.reduce((n, { object: s }) => n + (s.mesh?.tris.length ?? 0), 0);
  const records = new Float32Array(Math.max(visible.length, 1) * RECORD_F32);
  const points = new Float32Array(Math.max(totalPoints, 1) * 2);
  const meshTris = new Float32Array(Math.max(totalTris * 6, 1) * 4); // 2 vec4/vert (pos+grad), 3 verts/tri

  // bake every object's masks once (reused for sizing + writing); parallel to `visible`
  const bakedByObject = visible.map((rs) => rs.masks.map((m) => bakeMaskLoop(m.anchors)));
  const totalLoops = bakedByObject.reduce((n, loops) => n + loops.length, 0);
  const totalMaskVerts = bakedByObject.reduce((n, loops) => n + loops.reduce((k, l) => k + l.length, 0), 0);
  const maskLoops = new Float32Array(Math.max(totalLoops, 1) * 4);
  const maskVerts = new Float32Array(Math.max(totalMaskVerts, 1) * 2);

  let cpStart = 0;
  let triVec4 = 0; // running vec4 index into meshTris
  let loopIdx = 0; // running vec4 index into maskLoops
  let maskVertIdx = 0; // running vec2 index into maskVerts
  visible.forEach((rs, si) => {
    const s = rs.object;
    const type = getObjectType(s.typeId);
    const base = si * RECORD_F32;
    records[base] = gpuTypeIndex(s.typeId);
    // op (carve vs raise): a type with an `invert` param drives it per-instance (Stroke/Fill); others
    // fall back to the type-level defaultCombine (e.g. Groove).
    records[base + 1] = "invert" in s.params ? (s.params.invert === "carve" ? 1 : 0) : type.defaultCombine === "carve" ? 1 : 0;
    records[base + 3] = rs.tallnessZ; // composed extrude multiplier (tallness scale)
    records[base + 21] = rs.elevationZ; // composed base elevation (post-extrude add)
    // slots 4..9 = the composed inverse affine (world -> object-local); slot 10 = its forward scale hint.
    const inv = rs.invAffine;
    records[base + 4] = inv.a;
    records[base + 5] = inv.b;
    records[base + 6] = inv.c;
    records[base + 7] = inv.d;
    records[base + 8] = inv.e;
    records[base + 9] = inv.f;
    records[base + 10] = rs.scaleHint;
    records[base + 11] = cpStart;
    records[base + 12] = analytic(s) ? s.bezier!.length : s.controlPoints.length;
    records[base + 26] = s.closed ? 1 : 0; // analytic path is a closed loop (wrap last->first)
    records[base + 2] = s.ringSplit ?? (s.controlPoints.length >> 1); // base-ring count (rings objects)
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
    // Hole contour counts (Surface (Vector)): the baked vertex count of each hole ring, packed into the
    // slots right after this type's params (the wgsl reads them from there and CSG-subtracts each hole).
    if (s.contourCounts && s.contourCounts.length > 1) {
      for (let h = 1; h < s.contourCounts.length && paramKeys.length + h - 1 < MAX_PARAMS; h++) {
        records[base + PARAMS_OFFSET + paramKeys.length + h - 1] = s.contourCounts[h]!;
      }
    }
    if (analytic(s)) {
      // 4 vec2 per anchor: point, in-handle (offset), out-handle (offset), (radius, pad) — the WGSL
      // reads them as p/hIn/hOut + per-anchor tube radius. Resolve smooth (Catmull-Rom) tangents on the
      // CPU so the GPU samples the same curve; a closed path resolves with wrap-around neighbours.
      const rDefault = typeof s.params.radius === "number" ? s.params.radius : 0;
      for (const a of s.closed ? resolveHandlesClosed(s.bezier!) : resolveHandles(s.bezier!)) {
        points[cpStart * 2] = a.p.x;
        points[cpStart * 2 + 1] = a.p.y;
        points[cpStart * 2 + 2] = a.hIn.x;
        points[cpStart * 2 + 3] = a.hIn.y;
        points[cpStart * 2 + 4] = a.hOut.x;
        points[cpStart * 2 + 5] = a.hOut.y;
        points[cpStart * 2 + 6] = a.radius ?? rDefault; // per-anchor tube radius (Pipe (Vector) taper)
        points[cpStart * 2 + 7] = 0;
        cpStart += 4;
      }
    } else {
      for (const cp of s.controlPoints) {
        points[cpStart * 2] = cp.x;
        points[cpStart * 2 + 1] = cp.y;
        cpStart++;
      }
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
    const loops = bakedByObject[si]!;
    records[base + 24] = loopIdx;
    records[base + 25] = loops.length;
    rs.masks.forEach((m, mi) => {
      const verts = loops[mi]!;
      const flags = (m.mode === "cut" ? 1 : 0) + (m.follow ? 2 : 0) + (m.hard ? 4 : 0);
      maskLoops[loopIdx * 4] = maskVertIdx;
      maskLoops[loopIdx * 4 + 1] = verts.length;
      maskLoops[loopIdx * 4 + 2] = flags;
      maskLoops[loopIdx * 4 + 3] = m.scope; // scope id: union within, multiply across (group masks)
      loopIdx++;
      for (const vtx of verts) {
        maskVerts[maskVertIdx * 2] = vtx.x;
        maskVerts[maskVertIdx * 2 + 1] = vtx.y;
        maskVertIdx++;
      }
    });
  });
  return { records, points, meshTris, maskLoops, maskVerts, count: visible.length };
}
