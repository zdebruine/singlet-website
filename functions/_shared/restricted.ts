/**
 * Files that are held back from the public product, and files that are not offered in Research Alpha.
 *
 * 1. Restricted (private): outputs that carry per-donor germline information (genotype calls, read depth over a SNP
 *    panel, allele-specific counts, donor mitochondrial sequence, and in Alpha every mitochondrial allele layer and the
 *    ancestry call). They are kept in the pipeline and in private storage for internal tools and controlled-access
 *    accounts, but are not listed, served or counted by the public site, API or MCP server, and data.singlet.bio refuses
 *    range reads of them (workers/data-guard).
 * 2. Hidden (Alpha): layers that are in the legacy files but are not reliable yet (ambient RNA, doublet scores,
 *    per-cell non-host calls, the legacy percent-spliced-in matrix, mitochondrial event summaries, and the legacy
 *    pipeline sex call). The legacy 50-marker ancestry call is private (rule 1).
 *    The validated per-cell labels written by the s1 transcode (ancestry_hancestro / ancestry_prob, sex_chrom / sex_score,
 *    cell-type CL labels and path) are public, searchable cell metadata: they live in per-sample label sidecars
 *    (s1/a/<GSM>/<d>.parquet, named in the manifest) and the atlas cell index, not in members matched here, and nothing in
 *    this file hides them. Search, facets and MCP read them as facts (./s1-labels). Only raw genotype inputs stay private.
 *
 * Rules are written as an allowlist per directory so that a new output added to `donor/` or `mt/` is private
 * until someone decides otherwise. They are matched against the path *inside* `samples/<GSM>/`. The private rules
 * live in three places; keep them in step: here, the packer (`singlet-bio`, python/singlet/bundle.py
 * `is_restricted_member`) and the data.singlet.bio guard (workers/data-guard/src/policy.ts `isPrivateMember`).
 *
 * `bundle_index` in D1 still holds the full listing of whatever file is stored (internal tools and the catalog
 * crank read it), so every public reader goes through `publicEntries` (or `servedEntries` in ./alpha, which also
 * drops samples that are not part of the atlas) instead of using the raw entries.
 */
import { SAMPLE_RE } from "./bundle-reader";

/** Stays public inside donor/: barcode → donor label, no genotypes. */
const DONOR_PUBLIC = new Set(["donor_assignments.tsv"]);
/** Stays public inside mt/: per-cell event counts (not offered in Alpha, see HIDDEN). */
const MT_PUBLIC = new Set(["mt_summary.tsv"]);
/** Private members outside donor/ and mt/: allele-level or ancestry-identifying files. */
const PRIVATE_NAMES = new Set(["ase_counts.tsv", "mt_heteroplasmy.1pz", "mt_variants.tsv", "ancestry_call.json"]);

/** True for a path relative to `samples/<GSM>/`. Same rule as workers/data-guard `isPrivateMember`. */
export function isRestrictedMember(rel: string): boolean {
  if (rel.startsWith("donor/")) return !DONOR_PUBLIC.has(rel.slice("donor/".length));
  if (rel.startsWith("mt/")) return !MT_PUBLIC.has(rel.slice("mt/".length));
  if (PRIVATE_NAMES.has(rel)) return true;
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return /^snp_/.test(name) || /\.(vcf|bcf)(\.gz)?$/i.test(name) || /_mt_(consensus|variants)/.test(name);
}

/** True for a full archive path (`samples/<GSM>/…`) or a bare member name. */
export function isRestrictedPath(path: string): boolean {
  const m = SAMPLE_RE.exec(path);
  if (m) return isRestrictedMember(path.slice(m[0].length));
  if (path.startsWith("samples/")) return false;
  return isRestrictedMember(path);
}

/**
 * Layers present in legacy files that Alpha does not offer (docs/RESEARCH_ALPHA_PLAN.md §2c), relative to
 * `samples/<GSM>/`. A layer is hidden by its file; columns inside a public table (`is_doublet` in a cells table,
 * `prob_doublet` in donor_assignments.tsv) cannot be, and the Known Issues page says so.
 */
const HIDDEN_MEMBERS = new Set([
  // ambient RNA: rho is 0.27x the truth and the summary fraction is always 0
  "ambient_contamination.tsv",
  "ambient_contamination.json",
  "ambient_profile.tsv",
  // doublets flag 20-25% of cells
  "doublet_scores.tsv",
  // legacy PSI is 0 or 1 only; splice_events annotates its rows
  "splice_psi.1pz",
  "splice_events.tsv",
  // per-cell non-host counts unconfirmed taxa (the sample-level summary and abundance stay)
  "nonhost/nonhost_per_cell.1pz",
  "nonhost/nonhost_per_cell.tsv",
  // per-cell mtDNA event counts are derived from the variant calls, which are not released
  "mt/mt_summary.tsv",
  // the legacy pipeline sex call (XIST/chrY, upper-case gene names: every non-human call is "unknown"); s1 carries sex_chrom
  "sex_call.json",
]);

/** Human-only layers: written for other species too, but without a usable call. None in Alpha (the legacy sex call is hidden for all). */
const HUMAN_ONLY_MEMBERS = new Set<string>([]);

export interface EntryContext {
  /** True when the study is human. Human-only layers are hidden when this is false; unknown (undefined) is treated as not human. */
  human?: boolean;
  /** Samples that are not part of the atlas: every entry under `samples/<GSM>/` for these is dropped. */
  excluded?: ReadonlySet<string>;
}

/** True for a member relative to `samples/<GSM>/` that Alpha does not list or offer. */
export function isHiddenMember(rel: string, ctx: Pick<EntryContext, "human"> = {}): boolean {
  if (HIDDEN_MEMBERS.has(rel)) return true;
  return HUMAN_ONLY_MEMBERS.has(rel) && ctx.human !== true;
}

/**
 * The entries a visitor may see, in their original order: no restricted member, and, given a context, no hidden layer
 * and nothing of an excluded sample. Without a context only the restricted rule applies (callers that need the full
 * Alpha rule use servedEntries in ./alpha, which loads the context).
 */
export function publicEntries<T extends { p: string }>(entries: T[], ctx?: EntryContext): T[] {
  return entries.filter((e) => {
    if (isRestrictedPath(e.p)) return false;
    if (!ctx) return true;
    const m = SAMPLE_RE.exec(e.p);
    if (!m) return true;
    if (ctx.excluded?.has(m[1])) return false;
    return !isHiddenMember(e.p.slice(m[0].length), ctx);
  });
}

/** For a member name relative to the sample (v2 catalog members): restricted or hidden. */
export function isUnofferedMember(rel: string, ctx: Pick<EntryContext, "human"> = {}): boolean {
  return isRestrictedMember(rel) || isHiddenMember(rel, ctx);
}
