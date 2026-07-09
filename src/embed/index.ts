/**
 * Public entry for embedding the Lambert editor inside another application. A consumer renders
 * <LambertEditor host={...}/> and implements {@link EmbedHost} to persist the document and the
 * exported NX — no shell, no file explorer, no project settings. See EmbedHost.ts for the contract.
 */
export type { EmbedHost } from "./EmbedHost";
export { LambertEditor, type LambertEditorProps } from "./LambertEditor";
export { buildEmbedDoc, serializeEmbedDoc } from "./doc";
