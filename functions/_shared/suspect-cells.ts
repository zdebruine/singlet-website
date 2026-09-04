/**
 * Guard for the known `gsm.n_cells` pipeline bug.
 *
 * Plate-based / microwell protocols are processed as "one well = one cell", so
 * a plate sample reporting hundreds of thousands of cells is a pipeline
 * artifact, not real data. Until the upstream fix + D1 backfill lands, those
 * cell counts are excluded from headline SUMs and shown as "flagged" in the UI.
 *
 * Tune the thresholds here — this is the single source of truth for the API.
 * Keep in sync with src/lib/catalog-display.ts.
 */
import { PLATE_ASSAY_FAMILIES } from "./vocab";

/** Plate/microwell sample above this many cells is suspect. */
export const SUSPECT_CELL_COUNT_THRESHOLD = 5000;

/** Any sample above this is implausible regardless of protocol. */
export const HARD_SUSPECT_CELL_COUNT = 2_000_000;

export const PLATE_PROTOCOLS = [
  "smartseq2",
  "smartseq",
  "smart-seq2",
  "smart-seq3",
  "smartseq3",
  "plate",
  "seqwell",
  "microwell",
] as const;

/** SQL predicate (for use inside WHERE / FILTER) that is TRUE for suspect rows. */
export const SUSPECT_CELLS_SQL = `(
  (lower(coalesce(protocol, '')) IN (${PLATE_PROTOCOLS.map((p) => `'${p}'`).join(", ")})
   AND coalesce(n_cells, 0) > ${SUSPECT_CELL_COUNT_THRESHOLD})
  OR coalesce(n_cells, 0) > ${HARD_SUSPECT_CELL_COUNT}
)`;

export function isPlateLike(protocol: string | null | undefined, assayFamily?: string | null): boolean {
  const p = (protocol ?? "").toLowerCase();
  if ((PLATE_PROTOCOLS as readonly string[]).includes(p)) return true;
  return !!assayFamily && PLATE_ASSAY_FAMILIES.includes(assayFamily);
}

export function isSuspectCellCount(
  protocol: string | null | undefined,
  assayFamily: string | null | undefined,
  nCells: number | null | undefined
): boolean {
  if (nCells == null) return false;
  if (nCells > HARD_SUSPECT_CELL_COUNT) return true;
  return isPlateLike(protocol, assayFamily) && nCells > SUSPECT_CELL_COUNT_THRESHOLD;
}

/**
 * Study-level heuristic: plate-based study averaging > threshold cells per
 * processed sample, or any study averaging > HARD threshold per sample.
 */
export function isSuspectStudyCells(assayFamilies: string[], nCells: number, nDone: number): boolean {
  const perSample = nCells / Math.max(nDone, 1);
  if (perSample > HARD_SUSPECT_CELL_COUNT) return true;
  const plate = assayFamilies.some((a) => PLATE_ASSAY_FAMILIES.includes(a));
  return plate && assayFamilies.length === 1 && perSample > SUSPECT_CELL_COUNT_THRESHOLD;
}
