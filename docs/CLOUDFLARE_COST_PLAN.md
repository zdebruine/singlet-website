# Cloudflare cost: what drove the $434.75 invoice, and how to cut it

Source: Cloudflare dashboard, Billing → Billable usage (cycle Sep 27 – Oct 26, 2026), D1 `singlet-catalog` metrics and
query insights, read-only SQL against D1, and the singlet-website / singlet-bio code. Date: 2026-10-27.
Account: Zacharydebruine@gmail.com's Account (2f8a8cc9...).

## 1. Invoices

| Invoice | Date | Amount |
|---|---|---|
| IN-80852521 | Sep 25 | $10.46 |
| IN-81042139 | Sep 27 | $137.28 |
| IN-85868377 | Oct 27 | **$434.75** |

$434.75 = $429.74 usage + the $5 Workers Paid plan.

## 2. Where the $429.74 went

| Line | Usage | Cost | Share |
|---|---|---|---|
| **D1 rows written** | 419.1M (first 50M included) | **$370.00** | 86% |
| R2 data storage | 3.69k GB-months (about 3.7 TB average) | $55.25 | 13% |
| R2 Class A operations | 1.62M (first 1M included) | $4.50 | 1% |
| Everything else | Workers 463k requests, CPU 2.8M ms, D1 rows read 2.56B, R2 Class B 1.94M, KV, Workflows, D1 storage 0.4 GB | $0.00 | 0% |

Every other line is inside the included allowance. Public traffic is not what costs money: Workers requests are at 5% of the
included 10M, D1 reads at 10% of 25B, R2 Class B at 19% of 10M, and R2 egress is free.

## 3. What wrote 419M D1 rows

Facts:
- `singlet-catalog` is 430 MB and its largest tables are small (`gsm` 118k rows, `gse` 11k, `sample_attr` 131k, `sample_qc` 72k).
  419M writes on a database this size means the same rows were rewritten very many times.
- Writes were steady, not a burst, about 13–24M rows a day, and fall to **842 rows in the last 24 hours** after the 10-26 holds on
  `v3_controller`, `esc_oom_v2` and `reconpub`. The loops were the source.
- The query insights show `UPDATE gse SET r2_bundle_key=?, r2_bundle_bytes=?, last_updated=? WHERE id=?` run **1,481,844 times**
  (about 130 times per study), plus repeated multi-row `INSERT INTO gsm (...)` loads (v0.9.0 reloads and the 1.0.0 campaign on 10-26),
  128,787 `sample_attr` upserts and 30,840 `UPDATE gsm SET organism_primary...` updates.
- **Write amplification:** `gse` and `gsm` have triggers (`gse_au`, `gsm_au`, `gsm_ai`, `gse_ai`) that delete and re-insert the row in the
  FTS5 index on every UPDATE of any column, not just the text columns. `gsm` also carries 15 secondary indexes. One bookkeeping update
  (a bundle key, a status, a timestamp) therefore writes a dozen or more D1 rows.

Not verified: the insights table lists only the 200 most expensive distinct statements, and the top 10 by rows written add up to about
10M of the 407M. Each INSERT with literal values counts as a separate statement, so most of the writes are in statements the
dashboard does not show. The script behind `UPDATE gse SET r2_bundle_key` is not in the local repos; the likely source is the Anvil
publisher (`publish_study_v3.py` / `cf_bundle_v3.py`) or `reconcile_publish.sbatch`. Confirm before relying on this attribution.

## 4. Action plan

### Now (no code)
1. **Keep the holds** on `v3_controller` 21672176, `esc_oom_v2` 21672175, `reconpub` 787655, and do not release them until step 5 is in.
2. **Budget alerts** are set at $10 (default), then $50, $100 ... $500 (email to zacharydebruine@gmail.com).
3. **Check weekly** in Billable usage; target D1 rows written under 1M a day.

### Small code changes (singlet-website, singlet-bio) that remove most of the cost
4. **Scope the FTS triggers to the text columns:** `AFTER UPDATE OF id, title, abstract, organism ON gse` and
   `AFTER UPDATE OF gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics ON gsm`. Bookkeeping updates then no
   longer touch FTS. Rehearse on a D1 time-travel bookmark first.
5. **Make every writer skip no-op writes.** Read current state first (reads are nearly free: 25B included), then write only the diff:
   `UPDATE gse SET r2_bundle_key=? ... WHERE id=? AND r2_bundle_key IS NOT ?`, and `ON CONFLICT ... DO UPDATE ... WHERE <col> IS NOT excluded.<col>`
   for `sample_attr`. `reconcile_publish` should publish only studies that changed.
6. **Give every campaign a D1 write budget.** `s1_campaign.py` already has `--day-budget` (a sample row is 3 writes); extend the same pattern to the
   Anvil publisher and the ingest endpoint, log `meta.rows_written` per call, and abort when over budget.
7. **Review the 15 `gsm` indexes.** Drop the ones no query uses (candidates: status, sex, qc_flag, failure_category, protocol, pipeline_date). Each one is
   paid on every full-row rewrite. Check the query patterns first.

### R2 storage ($55 now, trending to about $120 during the transcode)
8. **Do not hold two full copies.** The Alpha transcode writes `.s1` objects beside the legacy bundles. Retire legacy bundles per study as soon as it
   verifies (plan item 6 in `RESEARCH_ALPHA_PLAN.md`), not at the end of the campaign.
9. **Move the private archive to Infrequent Access** ($0.01 per GB-month; the s1 migration plan already estimates about $27 a month) or off
   Cloudflare entirely (Clipper storage). Standard storage is $0.015.
10. **Add a lifecycle rule to abort incomplete multipart uploads** on `singlet-data`, and write fewer, larger objects from Beta jobs.
11. **Check the other buckets** (`singlet-restricted`, `singlet-user-data`, `singlet-hpc-dashboard`, `hpcbench-assets`, `cuvaio-files`,
    `morgan-vineyard-media`): their sizes were not visible. Everything stays in the one existing Cloudflare account (owner decision, 2026-10-27).

### Owner rule: no D1 writes without approval
12. **An agent must show a cost estimate and get the owner's approval in Claude before any write to production D1.** Implemented in the
    singlet-website PR (guard in `scripts/`, rule in `AGENTS.md`/`CLAUDE.md`).

## 5. Projection

| Scenario | D1 writes | R2 storage | Ops | Plan | Monthly |
|---|---|---|---|---|---|
| Loops held, no new bulk loads | about $0 | about $55–60 | about $0 | $5 | **about $60–65** |
| Alpha transcode in flight (two copies) | small if steps 4–6 are in | up to about $120 | $5–20 | $5 | about $130–150 |
| Same loops released with no fixes | $300–400 | as above | as above | $5 | $430+ again |

## 6. Will Alpha and Beta change the bill?

- **Visitors and MCP traffic: no.** Egress is free and the usage is far inside the included allowances. Even 10x traffic stays near $0 for
  Workers and D1 reads; extra reads cost $0.001 per million rows.
- **Our own pipeline: yes.** Beta re-processes every sample, so it will update the catalog for every sample again. At about 25 D1 rows per
  `gsm` row write (indexes plus FTS), one full pass over 118k samples is about 3M rows, roughly $3. The $370 came from the same rows being rewritten
  over and over, which is why steps 4–6 matter more than anything else.
- **Storage:** Beta adds another full copy of outputs. Budget it ($0.015 per GB-month, about $15 per TB) and put the retirement of
  superseded copies in the campaign plan.
