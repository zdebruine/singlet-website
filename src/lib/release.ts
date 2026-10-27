/**
 * What the Research Alpha serves right now. Copy that depends on the .s1-format transcode reads these flags, so the
 * cutover PR flips one line.
 *
 * S1_FORMAT_LIVE: false while data.singlet.bio serves the legacy .singlet study files (zip64 of .1pz members). Set it
 * to true when the per-sample .s1 objects (pz2 codec, manifests, packs, cell index) are what downloads, the API and
 * the MCP server read. The per-cell labels (cell type, chromosomal sex, genetic ancestry) ship with the .s1 objects, so
 * the annotation copy is gated on the same flag.
 */
export const S1_FORMAT_LIVE = true;

/** Per-cell labels are in Alpha only once the .s1 objects are served. */
export const ANNOTATIONS_LIVE = S1_FORMAT_LIVE;
