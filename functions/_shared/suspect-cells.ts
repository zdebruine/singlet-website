/**
 * Guard for the known `gsm.n_cells` pipeline bug.
 *
 * Plate-based / Smart-seq protocols are processed as "one well = one cell", so
 * a plate sample reporting hundreds of thousands of cells is a pipeline
 * artifact, not real data. Until the upstream fix + D1 backfill lands, those
 * cell counts are excluded from headline SUMs and shown as "flagged" in the UI.
 *
 * Tune the threshold here — it is the single source of truth for the API layer.
 */
export const SUSPECT_CELL_COUNT_THRESHOLD = 5000;

export const PLATE_PROTOCOLS = [
  "smartseq2",
  "smartseq",
  "smart-seq2",
  "smart-seq3",
  "plate",
] as const;

/** SQL predicate (for use inside WHERE / FILTER) that is TRUE for suspect rows. */
export const SUSPECT_CELLS_SQL = `(
  lower(coalesce(protocol, '')) IN (${PLATE_PROTOCOLS.map((p) => `'${p}'`).join(", ")})
  AND coalesce(n_cells, 0) > ${SUSPECT_CELL_COUNT_THRESHOLD}
)`;

export function isSuspectCellCount(
  protocol: string | null | undefined,
  nCells: number | null | undefined
): boolean {
  if (nCells == null) return false;
  const p = (protocol ?? "").toLowerCase();
  return (PLATE_PROTOCOLS as readonly string[]).includes(p) && nCells > SUSPECT_CELL_COUNT_THRESHOLD;
}
