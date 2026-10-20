/**
 * Files that are held back from the public product.
 *
 * Some outputs the pipeline computes carry per-donor germline information (genotype calls, read depth over
 * a SNP panel, allele-specific counts, donor mitochondrial sequence). They are kept in the pipeline and in
 * private storage for internal tools and controlled-access accounts, but are not listed, served or counted
 * by the public site, API or MCP server.
 *
 * Rules are written as an allowlist per directory so that a new output added to `donor/` or `mt/` is private
 * until someone decides otherwise. They are matched against the path *inside* `samples/<GSM>/`. The same rules
 * live in the packer (`singlet-bio`, python/singlet/bundle.py `is_restricted_member`); keep the two in step.
 *
 * `bundle_index` in D1 still holds the full listing of whatever file is stored (internal tools and the catalog
 * crank read it), so every public reader goes through `publicEntries` / `isRestrictedPath` instead of using
 * the raw entries.
 */
import { SAMPLE_RE } from "./bundle-reader";

/** Stays public inside donor/: barcode → donor label and doublet calls, no genotypes. */
const DONOR_PUBLIC = new Set(["donor_assignments.tsv"]);
/** Stays public inside mt/: per-cell event counts. */
const MT_PUBLIC = new Set(["mt_summary.tsv"]);

/** True for a path relative to `samples/<GSM>/`. */
export function isRestrictedMember(rel: string): boolean {
  if (rel.startsWith("donor/")) return !DONOR_PUBLIC.has(rel.slice("donor/".length));
  if (rel.startsWith("mt/")) return !MT_PUBLIC.has(rel.slice("mt/".length));
  if (rel === "ase_counts.tsv") return true;
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return /^snp_/.test(name) || /\.(vcf|bcf)(\.gz)?$/i.test(name);
}

/** True for a full archive path (`samples/<GSM>/…`) or a bare member name. */
export function isRestrictedPath(path: string): boolean {
  const m = SAMPLE_RE.exec(path);
  if (m) return isRestrictedMember(path.slice(m[0].length));
  if (path.startsWith("samples/")) return false;
  return isRestrictedMember(path);
}

/** The entries a visitor may see, in their original order. */
export function publicEntries<T extends { p: string }>(entries: T[]): T[] {
  return entries.filter((e) => !isRestrictedPath(e.p));
}
