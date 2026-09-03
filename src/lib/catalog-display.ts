/**
 * Display-layer rules for the catalog UI.
 * These never change stored values — they only affect what users see.
 */

/**
 * Known `n_cells` pipeline bug: plate-based protocols are "one well = one cell",
 * so implausibly large counts are artifacts. Tune the threshold here.
 * Keep in sync with functions/_shared/suspect-cells.ts.
 */
export const SUSPECT_CELL_COUNT_THRESHOLD = 5000;

export const PLATE_PROTOCOLS = [
  "smartseq2",
  "smartseq",
  "smart-seq2",
  "smart-seq3",
  "plate",
];

export function isSuspectCellCount(
  protocol: string | null | undefined,
  nCells: number | null | undefined
): boolean {
  if (nCells == null) return false;
  return PLATE_PROTOCOLS.includes((protocol ?? "").toLowerCase()) && nCells > SUSPECT_CELL_COUNT_THRESHOLD;
}

export const FLAGGED_CELLS_LABEL = "flagged — under review";

/** Friendly label for protocol values whose stored form is opaque. */
const PROTOCOL_LABELS: Record<string, string> = {
  "10x_suspect": "10x (protocol unconfirmed)",
};

export function protocolLabel(protocol: string | null | undefined): string {
  if (!protocol) return "—";
  return PROTOCOL_LABELS[protocol] ?? protocol;
}

/**
 * QC artifacts like "blank sample; Homo sapiens" are not organisms — hide them
 * from the filter UI (the underlying rows are untouched).
 */
export function isDisplayableOrganism(value: string | null | undefined): boolean {
  return !!value && !value.toLowerCase().includes("blank sample");
}
