# Cutover to the .s1 format

How singlet.bio moves from the legacy `.singlet` bundles to the per-sample `.s1` objects written by the transcode campaign
(Singlet-Bio/singlet `scripts/s1_campaign.py`, PR #54 on top of the s1 rename #56). Nothing here runs on merge: every step is an
owner action, in this order. Each step says how to roll it back.

Pieces:

| piece | where | what it does |
|---|---|---|
| data Worker `singlet-data` | `workers/data`, route `data.singlet.bio/s1/*` | serves manifests, sample objects, packs and ref index, cells tables, label sidecars, the atlas cell index |
| D1 `schema/038_s1_catalog.sql` | | `v2_*` tables become `s1_study` / `s1_sample` / `s1_migration` (`s1_bytes`), compatibility views under the old names, and `s1_flags.legacy_bundles` |
| D1 `schema/039_s1_labels.sql` | | `sample_cell_summary`, `label_term`, `study_label` (and the ontology tables production already has) |
| Pages (this repository) | | reads `s1_*`; search, facets and MCP filter on the labels; Docs and llms.txt describe `.s1` (`S1_FORMAT_LIVE = true`) |
| data-guard Worker | `workers/data-guard`, route `data.singlet.bio/data/*` | answers 410 for the legacy bundle of a study whose migration is verified, once the switch says `retired` |

The switch: `s1_flags.legacy_bundles` (`served` by default). While it is `retired`, every study whose migration is `verified` reads as
retired in the catalog (no legacy URL in the API, MCP, manifests or study pages) and the guard refuses its legacy file. The stored
migration status never changes, so turning it back to `served` restores everything at once. Studies without a verified `.s1` migration
are not affected.

## 0. Before anything (campaign output)

1. The full campaign has finished: every shard's results are summarized (`s1_campaign.py summarize`), no study is left `failed` that
   should be served, and `s1_readback.sbatch` passed on a sample of studies.
2. The reference packs are published: `s1_campaign.py refs-index --merge-prefix v2/ref/ --apply` (`s1/ref/index.json` lists every pack).
3. The atlas cell index is built: `scripts/s1_cidx_build.sbatch` (writes `$WORK/state/s1/<RUN>/cidx/` in server layout and
   `$WORK/state/s1/<RUN>/cidx-d1/sample_cell_summary.csv`).
4. The catalog SQL is written on Clipper: `python scripts/s1_campaign.py catalog-sql --from-r2 --out $WORK/state/s1/catalog-sql`
   (or `--rows-dir` from the run). `PLAN.txt` gives the days (at most `--day-budget` D1 row writes each) and `dayNN/APPLY.txt` the order.

## 1. Data Worker (laptop, wrangler)

```bash
cd workers/data && npx wrangler deploy && npx wrangler secret put CIDX_INTERNAL_SECRET
curl -sI https://data.singlet.bio/s1/ref/index.json | grep -i x-served-by          # singlet-data
curl -sI https://data.singlet.bio/v2/ref/index.json | grep -i x-served-by          # data-v2 (old script keeps /v2/*)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=0-63' "https://data.singlet.bio/$(curl -s https://data.singlet.bio/s1/m/GSE138867.json | grep -o '"key": *"s1/s/[^"]*"' | head -1 | sed 's/.*"\(s1[^"]*\)"/\1/')"   # 206
```

If the route does not win over the R2 custom domain, use the custom-domain fallback in `workers/data/README.md` and set the Pages
variable `S1_ORIGIN`. Rollback: `npx wrangler delete --name singlet-data` (the bucket is served as before).

## 2. D1 schema (laptop, wrangler)

```bash
npx wrangler d1 time-travel info singlet-catalog                                    # RECORD the bookmark
npx wrangler d1 execute singlet-catalog --remote --file=schema/038_s1_catalog.sql
npx wrangler d1 execute singlet-catalog --remote --file=schema/039_s1_labels.sql
npx wrangler d1 execute singlet-catalog --remote --command "SELECT name, value FROM s1_flags"   # legacy_bundles | served
```

The deployed build keeps working through the `v2_*` views. Rollback: `npx wrangler d1 time-travel restore singlet-catalog --bookmark=<recorded>`.

## 3. Merge this PR (Pages deploy)

Merge right after step 2, before the catalog SQL: the old build would name `v2/m/<GSE>.json` for studies the campaign flips. Then:

```bash
scripts/smoke.sh https://singlet.bio
curl -s https://singlet.bio/api/facets?level=gse | grep -o '"sex_genetic":\[[^]]*\]'   # [] until step 5
```

Rollback: redeploy the previous Pages build (the views keep the old build working).

## 4. Catalog SQL from the campaign (one D1 day budget per day)

For each `dayNN/` in order, run the lines of `APPLY.txt` (each file is atomic: `1_sample_*` first, then `2_flip_*`, which writes the
study row, removes older revs and sets the migration `verified` together):

```bash
cd $CATALOG_SQL/day01 && while read -r cmd; do $cmd || break; done < <(grep '^wrangler' APPLY.txt | sed 's/^/npx /')
```

A study is served from `.s1` as soon as its flip file is applied; its legacy file stays available (switch `served`). Check after each day:

```sql
SELECT status, COUNT(*) FROM s1_migration GROUP BY status;
SELECT COUNT(*) FROM s1_sample s JOIN s1_study st ON st.gse_id = s.gse_id AND st.rev = s.rev WHERE s.key NOT LIKE 's1/s/%';   -- 0
```

Rollback per study: `UPDATE s1_migration SET status = 'failed' WHERE gse_id = ...` (it falls back to its legacy file).

## 5. Labels and the cell index

```bash
npm run s1:labels-sql -- --summary cidx-d1/sample_cell_summary.csv --directory cidx/s1/cidx/v/<version>.json --out /tmp/labels-sql
for f in /tmp/labels-sql/*.sql; do npx wrangler d1 execute singlet-catalog --remote --file="$f" || break; done
```

Then upload the cell index (objects first, `s1/cidx/current.json` last; Singlet-Bio/singlet `docs/format-s1-cell-index.md` section 11) and check
`curl -s -X POST https://data.singlet.bio/s1/cidx/query -d '{"where":{}}'`. The facts are idempotent; reloading replaces them.

## 6. data-guard Worker with the switch (laptop, wrangler)

From the data-guard branch (website PR stacked on #68): `cd workers/data-guard && npx wrangler deploy`. With the switch `served` it
behaves as before; check that `curl -sI https://data.singlet.bio/data/GSE138867/GSE138867.singlet` still answers 200.

## 7. Retirement flip

Every served study must resolve to `.s1` objects first. This must return 0 rows (or the studies it lists are withheld on purpose):

```sql
SELECT g.gse_id FROM gse_meta g
 WHERE g.has_bundle = 1 AND NOT EXISTS (SELECT 1 FROM alpha_withheld w WHERE w.gse_id = g.gse_id)
   AND NOT EXISTS (SELECT 1 FROM s1_migration m JOIN s1_study s ON s.gse_id = m.gse_id WHERE m.gse_id = g.gse_id AND m.status IN ('verified', 'retired'));
```

Then:

```bash
npx wrangler d1 execute singlet-catalog --remote --command "UPDATE s1_flags SET value = 'retired', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE name = 'legacy_bundles'"
curl -sI https://data.singlet.bio/data/GSE138867/GSE138867.singlet | head -1       # 410 (within a minute: the guard caches the switch for 60 s)
SMOKE_RETIRED="GSE138867" SMOKE_S1="GSE138867" scripts/smoke.sh https://singlet.bio
```

Rollback: the same UPDATE with `'served'` (no deploy). Facets and search totals cached in `meta_cache` refresh within a day.

## 8. Later

Archive the legacy bytes privately, delete them from the public bucket, then `s1_campaign.py retire-sql` (step B: `verified` -> `retired`
for the archived studies). Cleanup: drop the `v2_*` views, the `/v2/*` route and script `singlet-data-v2`, and the dual-read code.
