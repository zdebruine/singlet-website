// What data.singlet.bio may serve from a legacy .singlet bundle during Research Alpha.
//
// 1. Germline-identifying members are never served: per-donor SNP counts, VCFs, allele-specific counts, donor mtDNA
//    consensus/variants, and (Alpha decision) every per-cell mitochondrial allele layer. Mirrors
//    functions/_shared/restricted.ts, widened for mtDNA and ancestry.
// 2. Samples that were processed incorrectly (wrong strand, non-RNA library processed as RNA, empty matrices) are not
//    part of Alpha: their members are never served, and studies with no sample left are not served at all.
import policy from "../policy/alpha-policy.json";

export const POLICY_VERSION: string = policy.version;
const WITHHELD = new Set<string>(policy.withheld_studies);
const EXCLUDED = new Set<string>(policy.excluded_samples);

const SAMPLE_RE = /^samples\/(GSM\d+)\//;
const DONOR_PUBLIC = new Set(["donor_assignments.tsv"]);
const MT_PUBLIC = new Set(["mt_summary.tsv"]);

export function isWithheld(gse: string): boolean {
  return WITHHELD.has(gse);
}

export function isExcludedSample(gsm: string): boolean {
  return EXCLUDED.has(gsm);
}

/** Germline or mtDNA allele data, for a path relative to samples/<GSM>/ (or a bare member name). */
export function isPrivateMember(rel: string): boolean {
  if (rel.startsWith("donor/")) return !DONOR_PUBLIC.has(rel.slice("donor/".length));
  if (rel.startsWith("mt/")) return !MT_PUBLIC.has(rel.slice("mt/".length));
  if (rel === "ase_counts.tsv" || rel === "mt_heteroplasmy.1pz" || rel === "mt_variants.tsv" || rel === "ancestry_call.json") return true;
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return /^snp_/.test(name) || /\.(vcf|bcf)(\.gz)?$/i.test(name) || /_mt_(consensus|variants)/.test(name);
}

export type Verdict = "ok" | "private" | "excluded";

export function classify(path: string): Verdict {
  const m = SAMPLE_RE.exec(path);
  if (m && EXCLUDED.has(m[1])) return "excluded";
  const rel = m ? path.slice(m[0].length) : path;
  return isPrivateMember(rel) ? "private" : "ok";
}
