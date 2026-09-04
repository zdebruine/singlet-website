# singlet.bio rebuild — roadmap

## Stage 1 — done
- [x] Design system, Logo, Navbar/Footer, Home, Docs, About, Browse re-skin, Study page re-skin, redirects, sitemap, OG image
- [x] Install lines are exactly `pip install singlet` / `install.packages("singlet")`

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

## Stage 4 — accounts, quotas, AI explanations, cleanup
### A. Auth (done)
- [x] Migration: `profiles` (+ trigger), `ai_search_usage`, `explanations`, `consume_ai_search`, `my_ai_usage_today`
- [x] `AuthProvider` (lazy client), `SignInDialog` (Google + email link), `AccountMenu` (usage today · sign out), `/auth/callback`
- [x] Google: Lovable broker on lovable-hosted previews; elsewhere the GoTrue 400 is turned into "not available on this site yet — use email"
- [ ] Operator: enable a native Google OAuth client (Lovable Cloud → Auth settings → Google) so Google works on singlet.bio; add `https://singlet.bio/auth/callback` + `https://*.singlet.pages.dev/auth/callback` to redirect URLs
### B. AI-search quota (done)
- [x] `_shared/quota.ts` (subject resolution, `consume`, env-tunable limits: anon 10 / user 200 search, user 100 explain)
- [x] `interpret-search-query`: budget gate before the model call; 429 `{error:"quota_exceeded", message, quota}`; `quota` on every reply
- [x] `/api/nl-search` forwards bearer / salted IP hash, keyword fallback when exhausted, `quota_exceeded` + `quota` in body, `X-Singlet-Quota` header (never cached), degraded answers not cached
- [x] UI: `AiQuotaBadge` counter, `AiQuotaExceeded` card with sign-in CTA, localStorage-backed `aiQuotaStore`
### C. Model-written "why it matches" (done)
- [x] `explain-results` edge function (signed-in, ≤ 10 studies/call, grounded one-liners, cached in `explanations`)
- [x] Browse: "Explain matches" button in the AI row; violet AI-badged "Why it matches" on cards and table
### D. Cleanup
- [x] Gold/Silver/Bronze, "1B+ cells", "Free for academic research", Benchmarks / Blog / Notebooks references removed; HPC dashboard unlinked but reachable
- [x] 404 page with search box; per-page titles; robots.txt allows all
- [x] Docs: search section documents the daily AI limits and what is stored
- [x] `sitemap.xml` Pages Function (static routes + `/study/<gse>` with has_bundle=1), edge-cached 1 day; static file removed
- [ ] Accessibility pass (labels, teal focus rings, contrast) on the new auth dialog + account menu
### E. Acceptance (after the Cloudflare deploy picks up the new Pages Functions)
- [ ] Anonymous on pages.dev: 10 AI searches → exhausted card; keyword search still works; `X-Singlet-Quota` present on fresh answers, absent on cache hits
- [ ] Signed-in (email link): counter shows n / 200; "Explain matches" writes AI lines; second click is free (cached)
- [ ] Python `singlet.find()` unauthenticated still works (same endpoint, per-IP budget)
- [ ] Study Table view at 1280 / 390: File column + year, no right-edge overflow

## Backlog / discovered
- Sync hazard: the HPC bot commits to GitHub `main` every 15 min and races Lovable's push. Move the bot to its own branch (or a data-only repo).
- Direct callers of `interpret-search-query` bypass the per-visitor budget (they are metered per IP instead). Add a shared secret between the Pages Function and the edge function once a Cloudflare env var can be set.
- Cell-type filter uses FTS on `{cell_type characteristics}` (prefix match); revisit if recall is a problem
- `gse_meta.year` is null for most studies; year facet is sparse until the ETL backfills it
- `meta_cache` rows refreshed lazily after 24h; an ETL hook could refresh them eagerly
- Study page: "Similar studies" strip; `/api/gsm/:id` should be edge-cached
- Account page: let signed-in users delete their account (profiles + usage rows) from the menu
