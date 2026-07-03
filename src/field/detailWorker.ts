import { decode } from "fast-png";
import { computeDetailField, type DetailParams } from "./detail";

/**
 * The Emboss/Detail compute worker — keeps the chain (Sobel + blur + FFT integration) off the UI
 * thread and resolves progressively, Blender-style: a fast low-res pass posts first so scrubbing
 * a chain param shows the effect immediately, then the full-res field lands when the queue goes
 * quiet. Latest-wins: only ONE pending job is kept; a newer request abandons a superseded
 * full-res pass at the next yield point.
 *
 * Protocol (ui/detailManager.ts is the only client):
 *   in:  { seq, key, params, bytes? }  — bytes accompany the first request per diffuse key only
 *   out: { seq, data, width, height, scale, final }  — preview (final=false) then full res
 *        { seq, needBytes: true }      — the decoded-diffuse cache evicted this key; resend bytes
 */

/** Preview target area: the low-res pass computes ~this many pixels regardless of doc size. */
const PREVIEW_AREA = 256 * 256;

interface Job {
  seq: number;
  key: string;
  params: DetailParams;
  bytes?: Uint8Array | null;
}

// Decoded diffuses, capped small — the bytes only travel once per doc, params changes send none.
const decoded = new Map<string, ReturnType<typeof decode>>();
const DECODE_CACHE_MAX = 4;

let latest: Job | null = null;
let running = false;

self.onmessage = (e: MessageEvent<Job>) => {
  latest = e.data;
  if (!running) void run();
};

const yieldToQueue = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function post(seq: number, field: { data: Float32Array; width: number; height: number; scale: number }, final: boolean): void {
  (self as unknown as Worker).postMessage(
    { seq, data: field.data, width: field.width, height: field.height, scale: field.scale, final },
    [field.data.buffer],
  );
}

async function run(): Promise<void> {
  running = true;
  while (latest) {
    const job = latest;
    latest = null;
    if (job.bytes) {
      decoded.set(job.key, decode(job.bytes));
      while (decoded.size > DECODE_CACHE_MAX) decoded.delete(decoded.keys().next().value!);
    }
    const img = decoded.get(job.key);
    if (!img) {
      (self as unknown as Worker).postMessage({ seq: job.seq, needBytes: true });
      continue;
    }
    const previewScale = Math.min(1, Math.sqrt(PREVIEW_AREA / (img.width * img.height)));
    if (previewScale < 0.9) {
      post(job.seq, computeDetailField(img, job.params, previewScale), false);
      await yieldToQueue(); // let a newer request land before committing to the expensive pass
      if (latest) continue; // superseded mid-scrub — skip the full-res pass entirely
    }
    post(job.seq, computeDetailField(img, job.params, 1), true);
    await yieldToQueue();
  }
  running = false;
}
