/**
 * The seam between the Lambert editor and a host that embeds it (e.g. a web app that stores
 * documents in a database rather than as files). The host supplies the diffuse and any existing
 * document, and receives save/export callbacks — it never touches the filesystem, the project
 * concept, or Lambert's document internals.
 *
 * The document payload is deliberately `unknown`: it is Lambert's versioned doc JSON, opaque to the
 * host, which only persists and returns it. The editor validates + migrates it through the document
 * schema on the way in (a malformed or older blob heals) and emits the current schema on the way
 * out. Canvas size, normal-direction encoding, and output format are the editor's concern — the
 * host provides none of them.
 */
export interface EmbedHost {
  /** The diffuse PNG bytes. The canvas size is read from it; there is no separate source reference. */
  diffuse: Uint8Array;
  /** An existing document (Lambert doc JSON, as previously handed to `onSave`), or null to start fresh. */
  initialDoc: unknown | null;
  /** Persist the current document. Called on the editor's save action; the payload is opaque doc JSON. */
  onSave(doc: unknown): Promise<void>;
  /** Render + persist the NX normal map: the exported PNG bytes plus the doc they were rendered from. */
  onExportNx(png: Uint8Array, doc: unknown): Promise<void>;
}
