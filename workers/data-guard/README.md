# data-guard: Research Alpha guard for legacy bundles

Route `data.singlet.bio/data/*`, in front of the public R2 custom domain (same mechanism as `workers/data-v2`). Deployed by the
owner with `npx wrangler deploy` from this directory; CI never deploys it.

What it enforces (policy in `policy/alpha-policy.json`, rules in `src/policy.ts`):

- **Germline and mtDNA allele data is never served.** Ranged reads that touch `donor/*` (except `donor_assignments.tsv`), `mt/*`
  (except `mt_summary.tsv`), `ase_counts.tsv`, `snp_*`, `*.vcf`, `mt_heteroplasmy.1pz`, `mt_variants.tsv` or `ancestry_call.json`
  get 403. Whole-file downloads of a bundle that holds genotype members or excluded samples get 503 until the Alpha repack replaces
  the file.
- **Samples not in Alpha** (wrong strand, non-RNA library processed as RNA, empty matrices) are never served: ranged reads into
  their members get 404, and studies with no sample left (`withheld_studies`) get 404 for every request.

The Worker reads a bundle's central directory through the R2 binding (zip64 aware) to map a byte range to members; allowed requests go
to the origin unchanged with `fetch(request)`, so CORS, ETag and Range behaviour stay R2's.

Regenerate `policy/alpha-policy.json` from the Alpha census (`samples_excluded.tsv`, `studies_action.tsv`) and redeploy whenever the
exclusion lists change (for example after the mouse strand classification).
