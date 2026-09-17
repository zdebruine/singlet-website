/**
 * Plausibility model for `gsm.n_cells`.
 *
 * Two independent pipeline defects inflate cell counts:
 *
 *  1. **Plate overcount** — plate/microwell protocols are processed as
 *     "one well = one cell", so a plate sample reporting tens of thousands of
 *     cells is an artifact. Physical ceiling is the plate size (96–384 wells);
 *     we allow 5,000 to cover pooled plates.
 *
 *  2. **Cell-calling failure** — when the knee/EmptyDrops step fails, ambient
 *     (empty) droplets are promoted to "cells". The count explodes *and* the
 *     median UMI per cell collapses to ambient level. This is the dominant
 *     defect, and the previous model missed all of it.
 *
 * The UMI collapse is the decisive evidence, measured over the live catalog
 * (72,156 DONE samples with cell counts, 2026-09-17):
 *
 *   n_cells range      n        median UMI (p50)   share with median UMI < 500
 *   ──────────────────────────────────────────────────────────────────────────
 *   0 – 5,000        41,156          1,609                   28.4%
 *   5,000 – 20,000   16,581            933                   29.6%
 *   20,000 – 50,000     601            221                   89.4%
 *   50,000 – 100,000    121             71                  100.0%
 *   > 100,000             4              6                  100.0%
 *
 * Above ~20k cells the population flips: essentially every sample is reporting
 * barcodes at or below ambient RNA level. A real cell does not have 71 UMIs.
 *
 * Verdicts:
 *   "ok"          — counted in headline totals.
 *   "suspect"     — provably inflated; excluded from totals, flagged in UI.
 *   "unverified"  — implausibly high but `median_umis` is absent, so the
 *                   ambient test cannot run. Excluded from headline totals and
 *                   reported separately rather than silently trusted.
 *
 * Combinatorial-indexing protocols (sci-RNA-seq, SPLiT-seq/Parse) genuinely
 * scale to >100k cells per library and are exempt from the plate and hard
 * ceilings — but not from the ambient-UMI test, which is quality-based and
 * valid for every chemistry.
 *
 * This is the single source of truth for the API.
 * Keep in sync with src/lib/catalog-display.ts.
 */
import { PLATE_ASSAY_FAMILIES } from "./vocab";

/** Plate/microwell sample above this many cells is a well-count artifact. */
export const PLATE_CELL_CEILING = 5_000;

/** Above this, a sample is checked against the ambient-UMI floor. */
export const DROPLET_REVIEW_THRESHOLD = 20_000;

/** Median UMIs/cell below this is ambient RNA, not cells. */
export const AMBIENT_UMI_FLOOR = 500;

/** No non-combinatorial protocol yields this many cells in one GSM. */
export const HARD_IMPLAUSIBLE_CELLS = 200_000;

/** Back-compat alias (was the plate threshold). */
export const SUSPECT_CELL_COUNT_THRESHOLD = PLATE_CELL_CEILING;
/** Back-compat alias (was the only hard ceiling). */
export const HARD_SUSPECT_CELL_COUNT = HARD_IMPLAUSIBLE_CELLS;

/**
 * Protocols where one well = one cell. Derived from the live catalog's
 * `protocol` values that map to PLATE_ASSAY_FAMILIES. Deliberately excludes
 * `scirna`, which shares the family label but is combinatorial.
 */
export const PLATE_PROTOCOLS = [
  "smartseq",
  "smartseq2",
  "smartseq3",
  "smart-seq2",
  "smart-seq3",
  "plate",
  "plate_based",
  "seqwell",
  "microwell",
  "microwell-seq",
  "celseq",
  "celseq2",
  "icell8",
  "marsseq",
  "marsseq2",
  "quartzseq2",
] as const;

/** Combinatorial indexing — legitimately reaches 10^5–10^6 cells per library. */
export const COMBINATORIAL_PROTOCOLS = [
  "scirna",
  "scirnaseq",
  "sci-rna-seq",
  "splitseq",
  "split-seq",
  "parse",
  "parse-biosciences",
] as const;

const sqlList = (xs: readonly string[]) => xs.map((p) => `'${p}'`).join(", ");

const PLATE_SQL = `lower(coalesce(protocol, '')) IN (${sqlList(PLATE_PROTOCOLS)})`;
const COMBI_SQL = `lower(coalesce(protocol, '')) IN (${sqlList(COMBINATORIAL_PROTOCOLS)})`;

/** SQL predicate — TRUE for provably inflated rows. Uses only `gsm` columns. */
export const SUSPECT_CELLS_SQL = `(
  (${PLATE_SQL} AND coalesce(n_cells, 0) > ${PLATE_CELL_CEILING})
  OR (coalesce(n_cells, 0) > ${DROPLET_REVIEW_THRESHOLD}
      AND median_umis IS NOT NULL AND median_umis < ${AMBIENT_UMI_FLOOR})
  OR (coalesce(n_cells, 0) > ${HARD_IMPLAUSIBLE_CELLS}
      AND NOT (${COMBI_SQL} AND coalesce(median_umis, 0) >= ${AMBIENT_UMI_FLOOR}))
)`;

/** SQL predicate — TRUE for implausibly high rows we cannot test (no median_umis). */
export const UNVERIFIED_CELLS_SQL = `(
  NOT ${SUSPECT_CELLS_SQL}
  AND coalesce(n_cells, 0) > ${DROPLET_REVIEW_THRESHOLD}
  AND median_umis IS NULL
)`;

/** SQL predicate — TRUE for rows whose cell count may enter headline totals. */
export const COUNTABLE_CELLS_SQL = `(NOT ${SUSPECT_CELLS_SQL} AND NOT ${UNVERIFIED_CELLS_SQL})`;

export type CellCountVerdict = "ok" | "suspect" | "unverified";

export function isPlateLike(protocol: string | null | undefined, assayFamily?: string | null): boolean {
  const p = (protocol ?? "").toLowerCase();
  if ((COMBINATORIAL_PROTOCOLS as readonly string[]).includes(p)) return false;
  if ((PLATE_PROTOCOLS as readonly string[]).includes(p)) return true;
  return !!assayFamily && PLATE_ASSAY_FAMILIES.includes(assayFamily);
}

export function isCombinatorial(protocol: string | null | undefined): boolean {
  return (COMBINATORIAL_PROTOCOLS as readonly string[]).includes((protocol ?? "").toLowerCase());
}

/** Classify a sample's cell count. `medianUmis` enables the ambient test. */
export function cellCountVerdict(
  protocol: string | null | undefined,
  assayFamily: string | null | undefined,
  nCells: number | null | undefined,
  medianUmis?: number | null
): CellCountVerdict {
  if (nCells == null) return "ok";

  if (isPlateLike(protocol, assayFamily) && nCells > PLATE_CELL_CEILING) return "suspect";

  if (nCells > HARD_IMPLAUSIBLE_CELLS && !(isCombinatorial(protocol) && (medianUmis ?? 0) >= AMBIENT_UMI_FLOOR)) {
    return "suspect";
  }

  if (nCells > DROPLET_REVIEW_THRESHOLD) {
    if (medianUmis == null) return "unverified";
    if (medianUmis < AMBIENT_UMI_FLOOR) return "suspect";
  }

  return "ok";
}

/** TRUE when the count is provably wrong. Unverified counts are NOT suspect. */
export function isSuspectCellCount(
  protocol: string | null | undefined,
  assayFamily: string | null | undefined,
  nCells: number | null | undefined,
  medianUmis?: number | null
): boolean {
  return cellCountVerdict(protocol, assayFamily, nCells, medianUmis) === "suspect";
}

/** TRUE when the count may contribute to headline totals. */
export function isCountableCellCount(
  protocol: string | null | undefined,
  assayFamily: string | null | undefined,
  nCells: number | null | undefined,
  medianUmis?: number | null
): boolean {
  return cellCountVerdict(protocol, assayFamily, nCells, medianUmis) === "ok";
}

/**
 * Study-level heuristic, used where per-sample rows are not loaded.
 * Plate study averaging over the plate ceiling, or any study averaging beyond
 * the hard ceiling, per processed sample.
 */
export function isSuspectStudyCells(assayFamilies: string[], nCells: number, nDone: number): boolean {
  const perSample = nCells / Math.max(nDone, 1);
  if (perSample > HARD_IMPLAUSIBLE_CELLS) return true;
  const plate = assayFamilies.some((a) => PLATE_ASSAY_FAMILIES.includes(a));
  return plate && assayFamilies.length === 1 && perSample > PLATE_CELL_CEILING;
}
