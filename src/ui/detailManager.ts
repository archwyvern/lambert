import { detailParamsKey, type DetailField, type DetailParams } from "../field/detail";

/**
 * Renderer-side front for the Emboss/Detail compute worker (field/detailWorker.ts): request a
 * field for (diffuse, chain params) and receive it via callback — a progressive low-res preview
 * first on large docs, the full-res field when the scrub settles. The caller keeps displaying
 * whatever field it already has until a fresher one arrives (Blender-style gradual resolve);
 * nothing here ever blocks the UI thread.
 *
 * Full-res results are cached per (diffuse key, params), so revisiting a setting is instant. The
 * diffuse bytes travel to the worker once per key; param scrubs post only the params.
 */

type Callback = (field: DetailField, final: boolean) => void;

interface Pending {
  seq: number;
  cacheKey: string;
  bytes: Uint8Array;
  key: string;
  params: DetailParams;
  cb: Callback;
  live: boolean;
}

const CACHE_MAX = 8;
const cache = new Map<string, DetailField>(); // full-res fields, insertion-ordered LRU-ish
const pending = new Map<number, Pending>();
const sentKeys = new Set<string>(); // diffuse keys the worker holds decoded
let worker: Worker | null = null;
let seq = 0;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../field/detailWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const msg = e.data as
      | { seq: number; needBytes: true }
      | { seq: number; data: Float32Array; width: number; height: number; scale: number; final: boolean };
    const p = pending.get(msg.seq);
    if (!p) return;
    if ("needBytes" in msg) {
      // the worker's decode cache evicted this diffuse — resend with bytes attached
      sentKeys.delete(p.key);
      request(p);
      return;
    }
    const field: DetailField = { data: msg.data, width: msg.width, height: msg.height, scale: msg.scale };
    if (msg.final) {
      cache.set(p.cacheKey, field);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      pending.delete(msg.seq);
    }
    if (p.live) p.cb(field, msg.final);
  };
  return worker;
}

function request(p: Pending): void {
  const w = ensureWorker();
  const withBytes = !sentKeys.has(p.key);
  if (withBytes) sentKeys.add(p.key);
  w.postMessage({ seq: p.seq, key: p.key, params: p.params, bytes: withBytes ? p.bytes : null });
}

/**
 * Request the detail field for a diffuse (stable `key` identifies it across param changes) and
 * chain params. The callback fires zero or more times: synchronously when the full-res field is
 * cached, otherwise preview-then-final from the worker (either may be skipped under supersession).
 * Returns a cancel function — after it, the callback never fires again.
 */
export function requestDetail(bytes: Uint8Array, key: string, params: DetailParams, cb: Callback): () => void {
  const cacheKey = `${key}|${detailParamsKey(params)}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    cb(hit, true);
    return () => {};
  }
  const p: Pending = { seq: ++seq, cacheKey, bytes, key, params, cb, live: true };
  pending.set(p.seq, p);
  request(p);
  return () => {
    // drop the entry too: a superseded job may never send its final, and the entry pins the bytes
    p.live = false;
    pending.delete(p.seq);
  };
}
