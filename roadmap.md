# singlet.bio rebuild — roadmap

## Stage 1 — done
- [x] Design system, Logo, Navbar/Footer, Home, Docs, About, Browse re-skin, Study page re-skin, redirects, sitemap, OG image
- [x] Install lines are exactly `pip install singlet` / `install.packages("singlet")`

## Stage 2 — search API + /browse (done)
- [x] vocab / conditions / search-core / facets-core / search / nl-search / gse detail / interpreter v2 / browse rebuild / dev harness

## Stage 3 — study page (done)
- [x] Header, facts, conditions table, abstract, download aside, samples table, JSON-LD

## Audit fixes (this run)
- [x] Recover Stage 2/3 files (main had been overwritten by the HPC snapshot bot; work was on `lovable-backup-main-1788538336` = GitHub `lovable-sync`)
- [ ] BUG 1: `/api/facets` — D1 rejects compound SELECTs with > 5 terms. Split per base into ≤ 4-term statements, run in one `db.batch`, merge rows. Shim emulates the limit.
- [ ] BUG 2a: API base — `*.pages.dev` previews DO have Pages Functions; only `lovable.app` / `lovableproject.com` hosts fall back to singlet.bio
- [ ] BUG 2b: top-level error boundary with retry card; every page tolerates missing / partial fields; client validates response shapes
- [ ] BUG 2c: client types aligned with live responses (fetched from the pages.dev preview)
- [ ] BUG 2d: page smoke test (`/tmp/browser/smoke/smoke.py <base>`): /, /browse, NL browse, filtered browse, /study/GSE178957, /study/GSE173706, /docs, /about, /nonexistent — zero console errors

## Stage 4 — accounts, quotas, AI summaries, cleanup
### A. Auth
- [ ] Google + email magic link (no passwords); `profiles` table + trigger; sign-in modal; avatar menu (Usage · Sign out)
### B. AI-search quota
- [ ] `ai_search_usage` table + RLS; atomic check/increment RPC (service role)
- [ ] `interpret-search-query`: accept JWT + `X-Client-Id`; anon 10 / 24h, signed-in 200 / day, `singlet-python/` `singlet-r/` UA 500 / day per IP; 429 `{error:'quota', limit, resets_at, signed_in}`
- [ ] `/api/nl-search` forwards Authorization + X-Client-Id, surfaces 429 unchanged (never cached)
- [ ] UI: quota card (anon → sign-in; signed-in → resets at), "n of 10 AI searches used today" counter (≥ 5)
### C. Model-written "why it matches" (signed-in only)
- [ ] `explain-results` edge function (top 5 studies, ≤ 25 words, grounded), `explanations` cache table (7 days), violet "AI summary:" line
### D. Cleanup
- [ ] Remove Gold/Silver/Bronze, `singlet-bio`, "Claude translates", "1B+ cells", "Free for academic research", Benchmarks / Blog / Notebooks references; HPC dashboard unlinked but reachable
- [ ] 404 page with search box
- [ ] Per-page titles ("GSE… — title · singlet.bio"), OG image + favicon from the logo
- [ ] robots.txt allow all; `sitemap.xml` Pages Function (static routes + `/study/<gse>` with has_bundle=1), cached 1 day
- [ ] `npm run build` clean; accessibility pass (labels, teal focus rings, contrast)
### E. Acceptance
- [ ] Anonymous: 10 AI searches → sign-in card; keyword search still works
- [ ] Google sign-in on published site (redirect URLs: singlet.bio + preview)
- [ ] Signed-in: AI summary lines + usage counter
- [ ] Python `singlet.find()` unauthenticated still works

## Backlog / discovered
- Sync hazard: Lovable ↔ GitHub syncs `main`; the HPC bot commits to GitHub `main` every 15 min and races Lovable's push. Move the bot to its own branch (or have it push to a data-only repo) to stop stranding work.
- Cell-type filter uses FTS on `{cell_type characteristics}` (prefix match); revisit if recall is a problem
- `gse_meta.year` is null for most studies; year facet is sparse until the ETL backfills it
- `meta_cache` rows refreshed lazily after 24h; an ETL hook could refresh them eagerly
- Study page: "Similar studies" strip; `/api/gsm/:id` should be edge-cached
