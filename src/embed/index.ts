/**
 * Public entry for embedding the Lambert editor inside another application. A consumer renders
 * <LambertEditor host={...}/> and implements {@link EmbedHost} to persist the document and the
 * exported NX — no shell, no file explorer, no project settings. See EmbedHost.ts for the contract.
 */
export type { EmbedHost } from "./EmbedHost";

export interface LambertEditorProps {
  host: import("./EmbedHost").EmbedHost;
  /** Fires whenever the document's dirty state flips, so the host can gate navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
}

// The editor component itself is added in Task 3.3, once DocEditor has been extracted from App.tsx.
// export { LambertEditor } from "./LambertEditor";
