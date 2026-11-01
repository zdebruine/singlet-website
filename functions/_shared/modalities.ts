/**
 * The modality registry: every non-gene-expression output the pipeline can
 * emit for a sample inside a `.singlet` bundle.
 *
 * This mirrors `MODALITIES` in the Python package (`singlet/bundle.py`) and
 * `SINGLET_MODALITIES` in the R package (`r/R/modalities.R`). Keep the three
 * in step — the names here are the names users pass to `bundle.read(...)` /
 * `singlet_read(...)`.
 *
 * Layers that carry per-donor germline information are not in this registry, and neither are the layers Research
 * Alpha does not offer (ambient RNA, doublet scores, legacy percent-spliced-in, mtDNA variants and heteroplasmy,
 * genetic ancestry, per-cell non-host, the legacy pipeline sex call): see ./restricted. They may still be inside a whole-file download.
 *
 * `members` lists candidate archive paths inside `samples/<GSM>/` in priority
 * order, because the layout changed across pipeline versions (e.g. donor
 * outputs moved from the sample root into a `donor/` subdirectory).
 */

export type ModalityKind = "matrix" | "table" | "json" | "text" | "binary";

export interface Modality {
  name: string;
  kind: ModalityKind;
  group: string;
  members: string[];
  description: string;
  /** Offered for human studies only (genetic sex). */
  humanOnly?: boolean;
  /** Display name, when it differs from what the file name suggests. */
  label?: string;
  /** How to get at it once the bundle is open. */
  python: string;
  r: string;
}

const M = (
  name: string,
  kind: ModalityKind,
  group: string,
  members: string[],
  description: string,
  python: string,
  r: string
): Modality => ({ name, kind, group, members, description, python, r });

export const MODALITIES: Modality[] = [
  // ── Counts ────────────────────────────────────────────────────────────────
  M("exon_counts", "matrix", "Counts", ["exon_counts.1pz"],
    "Per-exon-feature UMI counts (the spliced half of the raw matrix).",
    `b.read("exon_counts", gsm)`, `singlet_read(path, gsm, "exon_counts")`),
  M("intron_counts", "matrix", "Counts", ["intron_counts.1pz"],
    "Per-intron-feature UMI counts (the unspliced half of the raw matrix).",
    `b.read("intron_counts", gsm)`, `singlet_read(path, gsm, "intron_counts")`),
  M("cell_calls", "table", "Counts", ["cell_calls.tsv"],
    "Barcode, is_cell and the cell-calling statistics per barcode.",
    `b.read("cell_calls", gsm)`, `singlet_read(path, gsm, "cell_calls")`),
  M("cell_qc", "table", "Counts", ["cell_qc_metrics.tsv"],
    "Per-cell QC metrics (UMIs, genes, mitochondrial fraction, …).",
    `b.read("cell_qc", gsm)`, `singlet_read(path, gsm, "cell_qc")`),
  // ── Splicing ──────────────────────────────────────────────────────────────
  M("junctions", "matrix", "Splicing", ["sj_counts.1pz"],
    "Per-cell splice-junction counts.",
    `b.junctions(gsm)`, `singlet_read(path, gsm, "junctions")`),
  // ── Donor ─────────────────────────────────────────────────────────────────
  M("donor_assignments", "table", "Donor", ["donor/donor_assignments.tsv", "donor_assignments.tsv"],
    "Genotype-free donor demultiplexing: barcode → donor label.",
    `b.donors(gsm)`, `singlet_read(path, gsm, "donor_assignments")`),
  // ── Non-host ──────────────────────────────────────────────────────────────
  M("nonhost_species", "table", "Non-host", ["nonhost/nonhost_em_abundance.tsv", "nonhost_em_abundance.tsv"],
    "Per-taxon non-host (microbial/viral) abundance after EM re-assignment.",
    `b.nonhost(gsm)`, `singlet_read(path, gsm, "nonhost_species")`),
  M("nonhost_summary", "json", "Non-host", ["nonhost/nonhost_summary.json", "nonhost_summary.json"],
    "Non-host classification summary: reads classified, top taxa, database.",
    `b.read("nonhost_summary", gsm)`, `singlet_read(path, gsm, "nonhost_summary")`),
  // ── Immune repertoire ─────────────────────────────────────────────────────
  M("vdj_gene_usage", "matrix", "Immune", ["vdj_gene_usage.1pz"],
    "TR/IG gene expression (not clonotypes): per-cell reads on T- and B-cell receptor gene segments.",
    `b.vdj(gsm)`, `singlet_read(path, gsm, "vdj_gene_usage")`),
  // ── Companion libraries, chromatin, spatial ───────────────────────────────
  M("adt_counts", "matrix", "Protein", ["adt_counts.1pz"],
    "Antibody-derived tag (ADT/CITE-seq) UMI counts per tag and cell, columns aligned to the cells table.",
    `b.read("adt_counts", gsm)`, `singlet_read(path, gsm, "adt_counts")`),
  M("adt_panel", "json", "Protein", ["adt_panel.json"],
    "ADT/HTO panel: tag, antibody clone, sequence, specificity and ambient level.",
    `b.read("adt_panel", gsm)`, `singlet_read(path, gsm, "adt_panel")`),
  M("hto_counts", "matrix", "Protein", ["hto_counts.1pz"],
    "Hashtag-oligo (HTO) UMI counts per hashtag and cell.",
    `b.read("hto_counts", gsm)`, `singlet_read(path, gsm, "hto_counts")`),
  M("hto_classification", "table", "Protein", ["hto_classification.tsv"],
    "HTO demultiplexing: hashtag call, doublet flag and log-fold margins per cell.",
    `b.read("hto_classification", gsm)`, `singlet_read(path, gsm, "hto_classification")`),
  M("crispr_counts", "matrix", "CRISPR", ["crispr_counts.1pz"],
    "CRISPR guide UMI counts per guide and cell, columns aligned to the cells table.",
    `b.read("crispr_counts", gsm)`, `singlet_read(path, gsm, "crispr_counts")`),
  M("crispr_guides", "json", "CRISPR", ["crispr_guides.json"],
    "CRISPR guide library, per-cell guide-call summary and QC.",
    `b.read("crispr_guides", gsm)`, `singlet_read(path, gsm, "crispr_guides")`),
  M("vdj_contigs", "binary", "Immune", ["vdj_contigs.parquet"],
    "Assembled V(D)J contigs (chain, V/D/J/C genes, CDR3, UMIs) with per-cell clonotype labels (Parquet).",
    `b.read("vdj_contigs", gsm)`, `singlet_read(path, gsm, "vdj_contigs")`),
  M("vdj_summary", "json", "Immune", ["vdj_summary.json"],
    "V(D)J assembly provenance: method, reference, counting and library QC.",
    `b.read("vdj_summary", gsm)`, `singlet_read(path, gsm, "vdj_summary")`),
  M("atac_peak_counts", "matrix", "Chromatin", ["atac_peak_counts.1pz"],
    "ATAC cut sites per peak and cell, columns aligned to the cells table.",
    `b.read("atac_peak_counts", gsm)`, `singlet_read(path, gsm, "atac_peak_counts")`),
  M("atac_gene_activity", "matrix", "Chromatin", ["atac_gene_activity.1pz"],
    "ATAC fragments per gene (gene activity) and cell.",
    `b.read("atac_gene_activity", gsm)`, `singlet_read(path, gsm, "atac_gene_activity")`),
  M("atac_peaks", "table", "Chromatin", ["atac_peaks.bed", "peaks.bed"],
    "ATAC peaks called on the sample (BED).",
    `b.read("atac_peaks", gsm)`, `singlet_read(path, gsm, "atac_peaks")`),
  M("atac_fragments", "binary", "Chromatin", ["atac_fragments.tsv.gz", "fragments.tsv.gz"],
    "ATAC fragments (bgzip TSV, one row per fragment); the index is the same name plus .tbi.",
    `b.read("atac_fragments", gsm)`, `singlet_read(path, gsm, "atac_fragments")`),
  M("atac_summary", "json", "Chromatin", ["atac_summary.json"],
    "ATAC sample summary.",
    `b.read("atac_summary", gsm)`, `singlet_read(path, gsm, "atac_summary")`),
  M("spatial_positions", "table", "Spatial", ["spatial_positions.tsv", "spatial_coordinates.tsv"],
    "Spatial spot positions (array row/col, in tissue) per barcode.",
    `b.read("spatial_positions", gsm)`, `singlet_read(path, gsm, "spatial_positions")`),
  M("spatial_summary", "json", "Spatial", ["spatial_summary.json"],
    "Spatial sample summary.",
    `b.read("spatial_summary", gsm)`, `singlet_read(path, gsm, "spatial_summary")`),
  // ── Per-cell annotations ──────────────────────────────────────────────────
  M("cell_cycle_scores", "table", "Annotations", ["cell_cycle_scores.tsv"],
    "Per-cell S/G2M scores and phase assignment.",
    `b.read("cell_cycle_scores", gsm)`, `singlet_read(path, gsm, "cell_cycle_scores")`),
  // ── Sample-level QC ───────────────────────────────────────────────────────
  M("summary", "json", "QC", ["summary.json"],
    "Sample-level metrics: cells called, mapping rate, medians, reference build.",
    `b.qc(gsm)`, `singlet_read(path, gsm, "summary")`),
  M("pileup_stats", "json", "QC", ["pileup_stats.json"],
    "Alignment/pileup statistics for the sample.",
    `b.read("pileup_stats", gsm)`, `singlet_read(path, gsm, "pileup_stats")`),
  M("provenance", "json", "QC", ["provenance.json"],
    "Pipeline version, command line, reference checksums.",
    `b.read("provenance", gsm)`, `singlet_read(path, gsm, "provenance")`),
  M("saturation_curve", "table", "QC", ["saturation_curve.tsv"],
    "Sequencing-saturation curve (downsampled read depth vs genes detected).",
    `b.read("saturation_curve", gsm)`, `singlet_read(path, gsm, "saturation_curve")`),
  M("star_log", "text", "QC", ["star_Log.final.out"],
    "STAR final alignment log for the sample.",
    `b.read("star_log", gsm)`, `singlet_read(path, gsm, "star_log")`),
];

MODALITIES.find((m) => m.name === "vdj_gene_usage")!.label = "TR/IG gene expression (not clonotypes)";

export const MODALITY_BY_NAME = new Map(MODALITIES.map((m) => [m.name, m]));

/**
 * Resolve the modality registry against the files a sample actually has.
 * `files` are paths relative to `samples/<GSM>/`. Human-only modalities are resolved only when `human` is true.
 */
export function resolveModalities(files: string[], opts: { human?: boolean } = {}): { modality: Modality; member: string }[] {
  const have = new Set(files);
  const out: { modality: Modality; member: string }[] = [];
  for (const modality of MODALITIES) {
    if (modality.humanOnly && opts.human !== true) continue;
    const member = modality.members.find((m) => have.has(m));
    if (member) out.push({ modality, member });
  }
  return out;
}
