# singlet.bio rebuild — roadmap

## Stage 1 — done (restored to working tree 2026-09-04; had been stranded on a side branch)
- [x] Design system, Logo, Navbar/Footer, Home, Docs, About, Browse re-skin, Study page re-skin, redirects, sitemap, OG image
- [x] Correction: install lines are exactly `pip install singlet` / `install.packages("singlet")` (+ muted GitHub fallback note for R) everywhere

## Stage 2 — search API + /browse (this run)
- [x] `functions/_shared/vocab.ts` — canonical groups, organism alias maps, `loadRules`, `toGroup`
- [x] `functions/_shared/conditions.ts` — `summarizeConditions`, `conditionsLabel`
- [x] `functions/_shared/search-core.ts` — param parsing, FTS tokenizer, SQL builders, study/sample row shaping, `why` text
- [x] `/api/facets` rewrite — contextual counts, level=gse|gsm, meta_cache precompute for the unfiltered catalog
- [x] `/api/search` rewrite — AND across groups / OR within, bm25 ranking, accession short-circuit, `match`, `conditions`, `format=accessions`
- [x] `/api/nl-search` rewrite — canonical grounding, no silent relaxation, `suggestions`, `applied`, `why`
- [x] `/api/gse/:id` — add `conditions`, parsed characteristics; drop qc_flag
- [x] Edge function `interpret-search-query` v2 schema (organism sci names, canonical groups, cell_type free text, year range, residual q)
- [x] Frontend types/client, `/browse` rebuild (sticky search, interpretation row, facet rail, cards/table/samples, selection bar, empty state + suggestions, export accessions)
- [x] Home tiles → study counts from new facets; API base falls back to https://singlet.bio when not served from a first-party host
- [x] Local API harness (`scripts/dev-api`) for acceptance checks; remove dead `useDatabase.ts`
- [x] Acceptance checks G1–G5
- [x] Any-word fallback surfaced (`any_word` + note) on /api/search and /api/nl-search; interpreter model ladder (flash-lite → flash) with per-model timeouts
- [x] Browse fails into its error state (not a blank page) when the API answers with the pre-Stage-2 shape

## Stage 3 — study page (done)
- [x] Study page on the new API shape: header + meta line, facts, conditions table (click a value → filter samples), abstract, download aside (stacked `DownloadPanel`, provenance card)
- [x] Samples table: sort, status/condition/text filters, expandable rows (all characteristics, QC, SRA runs, pipeline provenance), `#GSM` anchor auto-expands (`/sample/GSM…` → `/study/GSE…#GSM…`)
- [x] JSON-LD `Dataset` + SEO title/description per study (`usePageMeta({ jsonLd })`, mounted as `#route-jsonld`)
- [x] Publications once `publications` is populated (component kept; renders when present)
- [x] "Cells in file" says "under review" when every processed sample's count is flagged (plate-based bug) instead of "0 cells"

## Stage 3b — polish / discovered while building the study page
- [ ] Failed-sample callout is untested locally (seed has only `DONE` rows) — verify against production once Stage 2/3 deploys
- [ ] Study page: "Similar studies" strip (same tissue_group + disease_group, via `/api/search?limit=4`) below the abstract
- [ ] `/api/gse/:id` edge cache (120s) — page loads hit D1 for `gsm` per study; wrap in `cachedJson` like search

## Stage 4 — accounts
- Sign in (Google + email), saved searches, model-written "why it matches" for signed-in users, higher AI-search limits

## Backlog / discovered
- Cell-type filter uses FTS on `{cell_type characteristics}` (prefix match) rather than a LIKE scan of `gsm.cell_type`, to keep rows_read low; revisit if recall is a problem
- HPC snapshot bot commits to `main` every 15 min; keep an eye on sync conflicts (it stranded Stage 1 once)
- `gse_meta.year` is null for most studies (only ~2.5K have `submitted_date`); year facet is sparse until the ETL backfills it
- Precomputed `meta_cache` rows (`facets:gse:all`, `facets:gsm:all`, `vocab:cell_type:top`) are refreshed lazily after 24h; an ETL hook could refresh them eagerly
