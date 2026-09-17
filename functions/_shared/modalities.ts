/**
 * The modality registry: every non-gene-expression output the pipeline can
 * emit for a sample inside a `.singlet` bundle.
 *
 * This mirrors `MODALITIES` in the Python package (`singlet/bundle.py`) and
 * `SINGLET_MODALITIES` in the R package (`r/R/modalities.R`). Keep the three
 * in step — the names here are the names users pass to `bundle.read(...)` /
 * `singlet_read(...)`.
 *
 * `members` lists candidate archive paths inside `samples/<GSM>/` in priority
 * order, because the layout changed across pipeline versions (e.g. donor
 * outputs moved from the sample root into a `donor/` subdirectory).
 */

export type ModalityKind = "matrix" | "table" | "json" | "text";

export interface Modality {
  name: string;
  kind: ModalityKind;
  group: string;
  members: string[];
  description: string;
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
  M("splice_psi", "matrix", "Splicing", ["splice_psi.1pz"],
    "Per-cell percent-spliced-in (PSI) per splice event.",
    `b.splice_psi(gsm)`, `singlet_read(path, gsm, "splice_psi")`),
  M("splice_events", "table", "Splicing", ["splice_events.tsv"],
    "Splice-event annotation for the rows of splice_psi.",
    `b.read("splice_events", gsm)`, `singlet_read(path, gsm, "splice_events")`),
  // ── Mitochondrial genome ──────────────────────────────────────────────────
  M("mt_heteroplasmy", "matrix", "Mitochondrial", ["mt_heteroplasmy.1pz"],
    "Per-cell mitochondrial heteroplasmy (VAF) per chrM variant site.",
    `b.mt_variants(gsm)`, `singlet_read(path, gsm, "mt_heteroplasmy")`),
  M("mt_variants", "table", "Mitochondrial", ["mt_variants.tsv", "mt/mt_summary.tsv"],
    "Called chrM variants with depth, allele counts and annotation.",
    `b.read("mt_variants", gsm)`, `singlet_read(path, gsm, "mt_variants")`),
  M("mt_events", "matrix", "Mitochondrial", ["mt/mt_events.1pz"],
    "Per-cell chrM allele-support matrix used for lineage tracing.",
    `b.read("mt_events", gsm)`, `singlet_read(path, gsm, "mt_events")`),
  // ── Donor / genotype ──────────────────────────────────────────────────────
  M("donor_assignments", "table", "Donor", ["donor/donor_assignments.tsv", "donor_assignments.tsv"],
    "Genotype-free donor demultiplexing: barcode → donor, with doublet calls.",
    `b.donors(gsm)`, `singlet_read(path, gsm, "donor_assignments")`),
  M("donor_snp_ad", "matrix", "Donor", ["donor/snp_ad.1pz"],
    "Per-cell alternate-allele depth over the SNP panel.",
    `b.read("donor_snp_ad", gsm)`, `singlet_read(path, gsm, "donor_snp_ad")`),
  M("donor_snp_dp", "matrix", "Donor", ["donor/snp_dp.1pz"],
    "Per-cell total read depth over the SNP panel (denominator for snp_ad).",
    `b.read("donor_snp_dp", gsm)`, `singlet_read(path, gsm, "donor_snp_dp")`),
  M("ase_counts", "table", "Donor", ["ase_counts.tsv"],
    "Allele-specific expression counts per gene.",
    `b.read("ase_counts", gsm)`, `singlet_read(path, gsm, "ase_counts")`),
  M("ancestry_call", "json", "Donor", ["ancestry_call.json"],
    "Continental ancestry estimate from the SNP panel.",
    `b.read("ancestry_call", gsm)`, `singlet_read(path, gsm, "ancestry_call")`),
  M("sex_call", "json", "Donor", ["sex_call.json"],
    "Genetic sex call from chrX/chrY expression and coverage.",
    `b.read("sex_call", gsm)`, `singlet_read(path, gsm, "sex_call")`),
  // ── Non-host ──────────────────────────────────────────────────────────────
  M("nonhost_species", "table", "Non-host", ["nonhost/nonhost_em_abundance.tsv", "nonhost_em_abundance.tsv"],
    "Per-taxon non-host (microbial/viral) abundance after EM re-assignment.",
    `b.nonhost(gsm)`, `singlet_read(path, gsm, "nonhost_species")`),
  M("nonhost_summary", "json", "Non-host", ["nonhost/nonhost_summary.json", "nonhost_summary.json"],
    "Non-host classification summary: reads classified, top taxa, database.",
    `b.read("nonhost_summary", gsm)`, `singlet_read(path, gsm, "nonhost_summary")`),
  // ── Immune repertoire ─────────────────────────────────────────────────────
  M("vdj_gene_usage", "matrix", "Immune", ["vdj_gene_usage.1pz"],
    "Per-cell V(D)J segment usage counts.",
    `b.vdj(gsm)`, `singlet_read(path, gsm, "vdj_gene_usage")`),
  // ── Per-cell annotations ──────────────────────────────────────────────────
  M("doublet_scores", "table", "Annotations", ["doublet_scores.tsv"],
    "Per-cell doublet score and call.",
    `b.read("doublet_scores", gsm)`, `singlet_read(path, gsm, "doublet_scores")`),
  M("cell_cycle_scores", "table", "Annotations", ["cell_cycle_scores.tsv"],
    "Per-cell S/G2M scores and phase assignment.",
    `b.read("cell_cycle_scores", gsm)`, `singlet_read(path, gsm, "cell_cycle_scores")`),
  M("ambient_contamination", "table", "Annotations", ["ambient_contamination.tsv"],
    "Per-cell ambient-RNA contamination fraction.",
    `b.read("ambient_contamination", gsm)`, `singlet_read(path, gsm, "ambient_contamination")`),
  M("ambient_profile", "table", "Annotations", ["ambient_profile.tsv"],
    "Ambient-RNA expression profile estimated from empty droplets.",
    `b.read("ambient_profile", gsm)`, `singlet_read(path, gsm, "ambient_profile")`),
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

export const MODALITY_BY_NAME = new Map(MODALITIES.map((m) => [m.name, m]));

/**
 * Resolve the modality registry against the files a sample actually has.
 * `files` are paths relative to `samples/<GSM>/`.
 */
export function resolveModalities(files: string[]): { modality: Modality; member: string }[] {
  const have = new Set(files);
  const out: { modality: Modality; member: string }[] = [];
  for (const modality of MODALITIES) {
    const member = modality.members.find((m) => have.has(m));
    if (member) out.push({ modality, member });
  }
  return out;
}
