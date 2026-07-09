import { decode } from "fast-png";
import { emptyDoc, parseDoc, serializeDoc, type LambertDoc } from "../document/schema";

/**
 * The doc's `source.uri` is vestigial in the embed: the diffuse bytes are injected directly, so the
 * resolver is never consulted. A benign relative placeholder keeps it a valid schema value.
 */
export const EMBED_SOURCE_URI = "diffuse.png";

/**
 * Build the working document for the embedded editor. With no existing document, start from an empty
 * doc sized to the diffuse; otherwise validate + migrate the host's stored blob through the document
 * schema (accepting either the parsed object it round-trips or parseDoc's native JSON string).
 */
export function buildEmbedDoc(diffuse: Uint8Array, initialDoc: unknown | null): LambertDoc {
  const { width, height } = decode(diffuse);
  if (initialDoc == null) return emptyDoc(EMBED_SOURCE_URI, width, height);
  return parseDoc(typeof initialDoc === "string" ? initialDoc : JSON.stringify(initialDoc));
}

/**
 * The value handed back to {@link EmbedHost.onSave}: the document as a plain JSON object (parseable
 * again by {@link buildEmbedDoc}). Objects suit a host that persists to a JSON/jsonb store; the
 * host treats it as opaque.
 */
export function serializeEmbedDoc(doc: LambertDoc): unknown {
  return JSON.parse(serializeDoc(doc));
}
