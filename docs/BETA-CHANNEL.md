# Research Beta channel (beta.singlet.bio)

Alpha (singlet.bio) and Beta (beta.singlet.bio) run the same code and the same package. The channels differ in configuration only.
Beta updates continuously: each finished sample is piped into Beta's R2 and D1 in the final layout, so the website, the Python and R
clients and the MCP server can be tested while the campaign runs. `.s1` (pz2 codec) is the only format. Genotypes and reads are never
public. Code is MIT, data CC0.

## Resources (account 2f8a8cc95b6bc0be84ac611fe2e5c3c2)

| What | Alpha | Beta |
|---|---|---|
| Pages project | `singlet` (branch `main`) | `singlet-beta` (branch `beta`), config `wrangler.beta.toml` |
| Site | singlet.bio | beta.singlet.bio, through the Worker `beta-singlet-proxy` (`workers/beta-proxy`; the deploy token cannot edit DNS, a Workers Custom Domain creates its own record) |
| D1 | `singlet-catalog` `fb42f359-92a0-452c-91e4-f630f627c4c7` | `singlet-beta-catalog` `75e54649-de1c-47c6-a242-718e2885748f` |
| R2, public objects (binding `SINGLET_DATA`) | `singlet-data` | `singlet-beta-data` |
| R2, dashboard JSON (binding `HPC_DASHBOARD`) | `singlet-hpc-dashboard` | `singlet-beta-dashboard` |
| Data Worker | `singlet-data` on data.singlet.bio/s1/* | `singlet-data-beta` (`workers/data/wrangler.beta.toml`) on beta-data.singlet.bio |
| `SINGLET_DATA_BASE` / `S1_ORIGIN` | https://data.singlet.bio | https://beta-data.singlet.bio |
| `CHANNEL` var | unset | `beta` |
| Account uploads (`USER_DATA`) | `singlet-user-data` | not bound |

Beta's D1 is a clone of the production schema (`schema/beta-clone-of-production.sql`, read from `sqlite_master` on 2026-10-29: tables
through migrations 032-041, FTS tables and indexes) with no production rows. `alpha_exclusions` and `alpha_withheld` are tables in the
channel's own database, so each channel has its own lists and Beta starts with none. The Pages secret `INGEST_TOKEN_SHA256` is set on
`singlet-beta` (digest of the Beta ingest token; the token is held by the owner and the GitHub secret `BETA_INGEST_TOKEN`).

Why the data Worker has its own cache host: the Cache API is shared by every Worker on the zone and keys include the host, so
`CACHE_ORIGIN` keeps Beta manifests from colliding with Alpha's.

## Deploy

```bash
VITE_DATA_BASE=https://beta-data.singlet.bio npm run build     # snippets and links name the Beta data host
npm run beta:deploy                                            # Pages: stages wrangler.beta.toml and deploys dist/ to singlet-beta
(cd workers/data && npx wrangler deploy -c wrangler.beta.toml) # data Worker
(cd workers/beta-proxy && npx wrangler deploy)                 # beta.singlet.bio
```

Production is never touched: `/api/ingest/s1-object` and `s1-publish` answer 403 unless `CHANNEL=beta`.

## Rolling ingest

Per finished sample (or a few at a time) from a cluster job, with `SINGLET_INGEST_TOKEN` set:

```bash
python scripts/beta/beta_ingest.py --manifest GSE138867.manifest.json --root /scratch/out --ledger ingest.jsonl
```

Standard library only. The manifest lists the samples finished so far (docs/format-s1.md section 7); `--root` holds the keys
(`s1/s/<GSM>/<d16>.s1`, `s1/a/<GSM>/<d16>.parquet`). It:

1. verifies each local object against the manifest (size, SHA-256) and the key (digest = first 16 bytes of the SHA-256);
2. uploads objects the bucket does not already hold with that SHA-256: `PUT /api/ingest/s1-object?key=…` with `X-Content-SHA256`
   (R2 rejects bytes that do not hash to it); over 80 MiB it uses multipart and the server reads the object back and hashes it;
3. publishes with `POST /api/ingest/s1-publish`: the server checks that every object the manifest names is in the bucket with the
   declared size and SHA-256 (409 otherwise, nothing written), writes `s1/m/<GSE>.json` last, then the D1 rows (same code as
   `/api/ingest/s1-study`).

Idempotent and resumable: a re-run uploads only what is missing, writes the manifest only if it differs, and writes no D1 row for an
unchanged rev (measured: 0 rows, 5 s). A re-run sample has a new digest, so a new key; the old object is harmless and unreferenced.
`private/*` keys (restricted sidecar) are refused by the server and never go to the public bucket (`restricted.ts` `isPrivateKey`).
Catalog metadata (`gse`, `gsm`, `sample_qc`, ...) goes through the existing `POST /api/ingest/<table>` and the `refresh-next` /
`index-next` cranks, as on Alpha; run `refresh-next` after a publish so counts and `studies_with_files` update.

Cost, measured on Beta with GSE138867 stand-ins: publishing 3 new samples wrote 14 D1 rows; growing to 5 samples (replacing the
3-sample rev) wrote 21; an unchanged re-publish wrote 0. That is about 3 rows per sample of the new rev, 1 per sample of the rev it
replaces and about 3 per publish. The uploader prints its estimate before posting. A publish after every sample of an n-sample study
writes about 4n rows each time, so publish once per job (or every k samples) for large studies. Time: 8 MB samples upload at about
1 MB/s through the Pages Function; a publish takes 2-5 s.

## Product test

`scripts/beta/product-test.mjs`, run daily by `.github/workflows/beta-product-test.yml` (and by hand). It takes the newest N samples
(`GET /api/ingest/s1-publish?n=`) and checks the data Worker's bytes and SHA-256 against the catalog and the manifest, the manifest
rev, the stats and study API, the SPA shell, the Python client (`SINGLET_DATA_BASE` only: `open_study`, `to_anndata`), the R client
(skipped when the installed package predates `singlet_study`) and `get_study` over MCP (key in `BETA_MCP_KEY`; a user
`beta-product-test` and its key exist in Beta's D1 only). The report is posted to
`/api/hpc/beta/product-test.json` (https://beta.singlet.bio/api/hpc/beta/product-test.json), which the launch checklist links.

## Stand-ins

Until Beta outputs exist, the validation uses three to five GSE138867 samples copied from Alpha's `.s1` objects with their catalog rows.
They are test data, not Beta results, and are removed before the first real Beta sample is published.

## Release policy and clean-up (Beta)

The data Worker's `src/policy.ts` imports `../policy/alpha-policy.json` (Alpha's withheld studies and excluded samples). `workers/data/wrangler.beta.toml`
aliases that import to `policy/beta-policy.json` (no withheld studies, no excluded samples; Beta excludes on its own QC later), so Alpha's lists do not apply
on beta-data.singlet.bio. The layers a public object may not carry (genotype, mtDNA alleles, ancestry call, ambient, doublet scores, per-cell non-host,
legacy PSI and sex call) are removed when the object is written, by the producer's `--policy`; the Worker does not see layers.

`DELETE /api/ingest/s1-delete` (Beta only, token, dry run unless `apply=1`) removes a study (manifest in R2, rows in `s1_sample`, `s1_migration`, `s1_study`) or
an object the catalog no longer references. `python scripts/beta/beta_ingest.py --delete-study GSE… [--delete-object KEY …] [--apply]`
calls it and refuses a base URL that is not a Beta host.
