/**
 * Display-time corrections for catalog values the data audit (scripts/data-audit) found to be inconsistent.
 * The database keeps what the pipeline wrote; these keep contradictory values off the API and the site.
 */

/** The pipeline's closed qc_flag vocabulary. Production still holds the retired gold/silver/bronze. */
const QC_FLAGS = new Set(["HEALTHY", "WARN", "LOW_QUALITY"]);

/**
 * A flag outside the closed vocabulary is not a verdict anyone can defend: every gold/silver/bronze row is
 * from pipeline v0.9.0, and 350 of the gold ones have a median under 30 genes per cell.
 */
export function sanitizeQcFlag(flag: unknown): "HEALTHY" | "WARN" | "LOW_QUALITY" | null {
  return typeof flag === "string" && QC_FLAGS.has(flag) ? (flag as "HEALTHY" | "WARN" | "LOW_QUALITY") : null;
}

const DROPLET_ASSAYS = new Set(["10x 3'", "10x 5'", "10x (version unconfirmed)", "Drop-seq / inDrop", "BD Rhapsody", "CITE-seq"]);

const MODALITY_LABELS: Record<string, string> = {
  scrna: "scRNA",
  snrna: "snRNA",
  plate_scrna: "plate scRNA",
  multiome: "multiome",
  atac: "ATAC",
  ambiguous: "ambiguous",
};

/**
 * One spelling per modality, and no plate label on a droplet assay: plate_scrna was assigned to samples whose
 * chemistry was only a guess (protocol 10x_suspect), while the assay family says droplet 10x.
 */
export function normalizeModality(modality: unknown, assayFamily: unknown): string | null {
  if (typeof modality !== "string" || !modality.trim()) return null;
  const key = modality.trim().toLowerCase();
  if (key === "plate_scrna" && typeof assayFamily === "string" && DROPLET_ASSAYS.has(assayFamily)) return MODALITY_LABELS.scrna;
  return MODALITY_LABELS[key] ?? modality.trim();
}
