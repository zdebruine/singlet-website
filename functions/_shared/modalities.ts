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
 * genetic ancestry, per-cell non-host): see ./restricted. They may still be inside a whole-file download.
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
  M("sex_call", "json", "Donor", ["sex_call.json"],
    "Genetic sex call from chrX/chrY expression and coverage. Human studies only: calls for other species are all \"unknown\" so far.",
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
    "TR/IG gene expression (not clonotypes): per-cell reads on T- and B-cell receptor gene segments.",
    `b.vdj(gsm)`, `singlet_read(path, gsm, "vdj_gene_usage")`),
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

MODALITIES.find((m) => m.name === "sex_call")!.humanOnly = true;
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
