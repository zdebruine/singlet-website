/**
 * What the Research Alpha serves right now. Copy that depends on the store-format transcode reads these flags, so the
 * cutover PR flips one line.
 *
 * STORE_FORMAT_LIVE: false while data.singlet.bio serves the legacy .singlet study files (zip64 of .1pz members). Set it
 * to true when the per-sample store objects (.s1, pz2 codec, manifests, packs, cell index) are what downloads, the API and
 * the MCP server read. The per-cell labels (cell type, chromosomal sex, genetic ancestry) ship with the store objects, so
 * the annotation copy is gated on the same flag.
 */
export const STORE_FORMAT_LIVE = false;

/** Per-cell labels are in Alpha only once the store objects are served. */
export const ANNOTATIONS_LIVE = STORE_FORMAT_LIVE;
