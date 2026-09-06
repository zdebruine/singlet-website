# singlet.bio rebuild — roadmap

## Stage 1 — done
- [x] Design system, Logo, Navbar/Footer, Home, Docs, About, Browse re-skin, Study page re-skin, redirects, sitemap, OG image

## Stage 2 — search API + /browse (done)
- [x] vocab / conditions / search-core / facets-core / search / nl-search / gse detail / interpreter v2 / browse rebuild / dev harness

## Stage 3 — study page (done)
- [x] Header, facts, conditions table, abstract, download aside, samples table, JSON-LD

## Audit fixes (done)
- [x] Recover Stage 2/3 files (main had been overwritten by the HPC snapshot bot)
- [x] BUG 1: `/api/facets` — split into ≤ 4-term statements in one `db.batch` (D1 compound-select limit), shim emulates the limit
- [x] BUG 2a: API base — same-origin by default; only `lovable.app` / `lovableproject.com` / `lovable.dev` hosts fall back to singlet.bio
- [x] BUG 2b: pathname-keyed error boundary; every client response goes through a normaliser with defaults
- [x] BUG 2c: client types aligned with live responses
- [x] BUG 2d: page smoke test (`/tmp/browser/smoke/smoke.py <base>`)

## Stage 4 — accounts, quotas, AI explanations, cleanup (done)
- [x] Migration: `profiles` (+ trigger), `ai_search_usage`, `explanations`, `consume_ai_search`, `my_ai_usage_today`
- [x] `AuthProvider` (lazy client), `SignInDialog`, `AccountMenu`, `/auth/callback`
- [x] `_shared/quota.ts` (subject resolution, `consume`, env-tunable limits: anon 10 / user 200 search, user 100 explain)
- [x] `interpret-search-query`: budget gate before the model call; 429 `{error:"quota_exceeded", message, quota}`
- [x] `/api/nl-search` forwards bearer / salted IP hash, keyword fallback when exhausted, `X-Singlet-Quota` header (never cached)
- [x] `explain-results` edge function; "Explain matches" in the AI row
- [x] `sitemap.xml` Pages Function (static routes + `/study/<gse>` with has_bundle=1)

## Stage 5 — review feedback, API keys, MCP (done in code; deploy acceptance pending)
### A. Install commands (GitHub for now)
- [x] `src/lib/install-snippets.ts` — single constants for Python / R; switch to `pip install singlet` / `install.packages("singlet")` is a one-line change
- [x] Home, /docs, study page, download panel, selection bar, README use the constants; no "coming soon" notes anywhere
### B. Copy cleanup
- [x] No "Cloudflare" / "R2" / `hello@singlet.bio` in user-facing copy; GitHub Issues is the only contact channel (footer, /about, /docs, 404, error card, legal pages)
- [x] `/api/gse/:id` returns `bundle_key` / `bundle_bytes` / `bundle_url`; client reads those (legacy `r2_bundle_*` kept in the JSON for the packages)
### C. One search bar
- [x] Exactly one `type=search` input per page (hero on /, sticky bar on /browse, navbar compact box elsewhere; mobile menu box has its own id)
- [x] Placeholder: "Describe what you're looking for — a tissue, disease, cell type, organism, or a GSE accession"
- [x] Rail / sample-table filter inputs are `type=text` (they narrow lists, they are not site search)
- [x] Quota exhausted → same bar, keyword mode, notice shown; chip edits re-run with `interpret=0`
### D. Sign-in providers
- [x] SignInDialog: Google, GitHub, divider, email
- [x] AuthProvider: Google (managed broker on Lovable hosts, native elsewhere) + GitHub via `github-oauth` edge function + `/auth/github/callback` relay; human errors when a provider is not configured
- [ ] Operator: create the GitHub OAuth app and add `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` as backend secrets; Google client id/secret in Lovable Cloud auth settings (details in the Stage 5 report)
- [ ] Operator: add `https://*.singlet-4gc.pages.dev/**` to the auth redirect allow-list so email links and Google land on previews (GitHub already works there)
### E. API keys
- [x] Migration: `api_keys` + `resolve_api_key` / `touch_api_key` RPCs, owner-read RLS
- [x] Edge function `api-keys` (list / create / revoke, service role, hash logic in one place, 20 active keys max)
- [x] `functions/_shared/identity.ts`: `Bearer sk_live_…` / `X-API-Key`, 60 s per-isolate cache, `last_used_at` at most every 5 min
- [x] `/api/nl-search`, `/api/search`, `/api/gse/:id`, `/api/facets`, `/api/stats` accept a key; invalid / revoked → 401 with the /account hint
- [x] Quota: key requests are charged to the owner's signed-in budget (edge function resolves the key)
- [x] `/account` page: email, plan, usage today, API keys (create with name + expiry, list, revoke, one-time reveal + copy) — verified in-browser with a throwaway login
- [x] /docs "API keys & MCP" section (curl, `singlet.set_api_key`, `SINGLET_API_KEY`)
### F. MCP server `https://singlet.bio/mcp`
- [x] `functions/mcp.ts` — Streamable HTTP, stateless JSON-RPC 2.0; initialize / initialized / ping / tools/list / tools/call; protocol 2025-06-18 + 2025-03-26
- [x] Tools: `search_datasets`, `get_study`, `get_download_url`, `get_atlas_stats` (content + structuredContent + `_meta.rate_limit` when a quota applies)
- [x] `tools/call` without a key → JSON-RPC error pointing at /account
- [x] /docs "Use singlet from Claude / ChatGPT / Cursor" with config blocks
### G. Acceptance
- [x] One search input per page; "microglia in the aging mouse brain" from home → /browse chips + results; removing a chip re-runs (local preview against live API)
- [x] `dist/` sweep: no hosting-provider or `hello@` strings in user-facing bundles (only library internals / a `_redirects` comment / minified identifiers)
- [x] `npm ci && npm run build` from a clean checkout
- [x] Zero console errors on /, /browse, /study/GSE178957, /docs, /account (only the dev-only ref warning from the editor tagger)
- [x] MCP + API-key transcript (initialize → tools/list → tools/call, bad / missing / revoked key) against the local harness
- [ ] Re-run the MCP transcript and the page smoke test against `https://<branch>.singlet-4gc.pages.dev` after the next deploy
### H. Small fixes
- [x] Study QC tiles: hide tiles with no data; "Per-sample QC metrics were not recorded for this study." when none

## Stage 6 — Quickstart & bundle sample count (done)
- [x] New `/quickstart` page with install/find/load steps, MCP config, good-to-know, GitHub Issues link
- [x] Navbar "Quickstart" link and home hero "5-minute quickstart →" link
- [x] `functions/_shared/study-core.ts` + `/api/gse/:id` expose `bundle_n_samples` from `gse.r2_bundle_n_gsms` (null until packing job indexes it)
- [x] Study download panel shows "Contains N of M processed samples" only when the API provides a differing count
- [x] `/docs` API keys section updated with R `set_api_key(...)` and keyless `find()` limit note
- [x] `/quickstart` added to sitemap static routes
- [x] Fix preview typecheck error: `bundle_n_samples` missing in `normalizeGseDetail`
- [ ] Push Stage 6 commits to GitHub `main` (blocked by sandbox `git push` restriction)

## Stage 8 — what's really in the file (in progress)
- [x] `functions/_shared/bundle-reader.ts` — zip64 central-directory reader over HTTP Range against data.singlet.bio; index memoised in D1 `bundle_index`
- [x] `functions/_shared/bundle-core.ts` — per-sample `summary.json` → `sample_qc` (D1 memo), study/sample file listing
- [x] `/api/bundle/:gse/index`, `/samples`, `/entry?path=…` (inflate ≤ 4 MB at the edge; larger → byte-range recipe), `?refresh=1`
- [x] `GET /api/manifest` — bulk manifest for a whole search (tsv/json/curl/wget/python/r, ≤ 2,000 studies)
- [x] `GET /api/gse/:id/related`
- [x] `/api/gse/:id` series: `reference_build`, `singlet_version`, `packed_at`, `bundle_n_samples`, `doi`
- [x] ingest: `sample_qc` table + `index-bundle` action (≤ 25 studies per call)
- [x] dev harness routes + local schema for the new tables
- [ ] Study page: reference/PubMed/Cite (BibTeX+RIS), file QC samples table, provenance, file tree, related
- [ ] Browse: sort control + manifest export menu; year on cards
- [ ] Docs: partial downloads, bulk manifests, provenance/versioning, comparison table; /about caps disclosure; home quick-start hubs

## Backlog / discovered
- `public/notebooks/*.html` are stale June exports (old `.1pz` format); unlinked but still served. Delete them or regenerate from the GitHub notebooks.
- A revoked key keeps working for up to 60 s on an edge isolate that cached it (documented on /account). Add a "revoked" push (KV) if that window ever matters.
- `explanations` table has RLS on with no policies (service role only) — intended; add a comment/policy if a client read is ever needed.
- Sync hazard: the HPC bot commits to GitHub `main` every 15 min and races Lovable's push. Move the bot to its own branch (or a data-only repo).
- Direct callers of `interpret-search-query` bypass the per-visitor budget (they are metered per IP instead). Add a shared secret between the Pages Function and the edge function once a Cloudflare env var can be set.
- Cell-type filter uses FTS on `{cell_type characteristics}` (prefix match); revisit if recall is a problem
- `gse_meta.year` is null for most studies; year facet is sparse until the ETL backfills it
- `meta_cache` rows refreshed lazily after 24h; an ETL hook could refresh them eagerly
- Study page: "Similar studies" strip; `/api/gsm/:id` should be edge-cached
- Account page: let signed-in users delete their account (profiles + usage rows) from the menu
- Accessibility pass (labels, teal focus rings, contrast) on the auth dialog, account menu and /account

## Stage 11 — ranked search, filters and browse experience
- [x] Replace interpreted-facet AND search with weighted full/partial ranking and structured match evidence
- [ ] Share ranking with keyword search, MCP search, and healthy-control matching
- [x] Add file/QC/publication/condition filters, Any/All semantics, URL state, conditional facets, caching, and indexes
- [ ] Rebuild browse cards, grouped results, drawer, sorting, and 25-row progressive pagination
- [ ] Preserve package-lock.json; pass app build and Functions typecheck
- [ ] Verify specified production queries, timings, mobile drawer, and URL round-trip after deployment

- [x] Fix all current preview typecheck/build errors from observability log

## Stage 12 — private projects, cohorts, workspaces and usage
- [ ] Private project storage, upload/register/delete, indexing, search/study/API/MCP integration
- [ ] Saved cohorts, sharing, comments, exports, diffs and MCP tools
- [ ] Workspaces, membership/invites, caps and activity feed
- [ ] Usage events, account usage summaries and weekly email opt-in
- [ ] Documentation and quickstart updates with preview-limit language
- [ ] Build/typecheck/package-lock verification and production throwaway-account acceptance
