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

## Stage 5 — review feedback, API keys, MCP
### A. Install commands (GitHub for now)
- [ ] `src/lib/install-snippets.ts` — single constants for Python / R; switch to `pip install singlet` / `install.packages("singlet")` is a one-line change
- [ ] Home, /docs, study page, selection bar, README use the constants; no "coming soon" notes anywhere
### B. Copy cleanup
- [ ] No "Cloudflare" / "R2" / `hello@singlet.bio` in user-facing copy; GitHub Issues is the only contact channel (footer, /about, /docs, 404, error card, legal pages)
- [ ] `/api/gse/:id` returns `bundle_key` / `bundle_bytes`; client reads those names
### C. One search bar
- [ ] Exactly one search input per page (navbar compact box rendered once; hidden on 404 which has its own)
- [ ] Placeholder: "Describe what you're looking for — a tissue, disease, cell type, organism, or a GSE accession"
- [ ] Rail filter inputs are not `type=search` (they narrow lists, they are not site search)
- [ ] Quota exhausted → same bar, keyword mode, notice shown
### D. Sign-in providers
- [ ] SignInDialog: Google, GitHub, divider, email
- [ ] AuthProvider: generic OAuth (`google` | `github`), human errors when a provider is not configured
- [ ] Operator: paste Google + GitHub client credentials in Lovable Cloud auth settings (details in the Stage 5 report)
### E. API keys
- [ ] Migration: `api_keys` + `resolve_api_key` / `touch_api_key` RPCs, owner-read RLS
- [ ] Edge function `api-keys` (create / revoke, service role, hash logic in one place)
- [ ] `functions/_shared/identity.ts`: `Bearer sk_live_…` / `X-API-Key`, 60 s per-isolate cache, `last_used_at` at most every 5 min
- [ ] `/api/nl-search`, `/api/search`, `/api/gse/:id`, `/api/facets` accept a key; invalid / revoked → 401
- [ ] Quota: key requests are charged to the owner's signed-in budget (edge function resolves the key)
- [ ] `/account` page: email, plan, usage today, API keys (create with name + expiry, list, revoke, one-time reveal + copy)
- [ ] /docs "API keys & MCP" section (curl, `singlet.set_api_key`, `SINGLET_API_KEY`)
### F. MCP server `https://singlet.bio/mcp`
- [ ] `functions/mcp.ts` — Streamable HTTP, stateless JSON-RPC 2.0; initialize / initialized / ping / tools/list / tools/call
- [ ] Tools: `search_datasets`, `get_study`, `get_download_url`, `get_atlas_stats` (content + structuredContent + `_meta.rate_limit`)
- [ ] `tools/call` without a key → JSON-RPC error pointing at /account
- [ ] /docs "Use singlet from Claude / ChatGPT / Cursor" with config blocks
### G. Acceptance
- [ ] One search input per page; "human PBMC covid-19" from home → /browse chips + results; removing a chip re-runs
- [ ] `grep -ri "cloudflare\|hello@" dist/` and `grep -r "R2" dist/` empty
- [ ] `npm ci && npm run build` from a clean checkout
- [ ] Zero console errors on /, /browse, /study/GSE178957, /docs, /about, /account
- [ ] MCP transcript (initialize → tools/list → tools/call) against pages.dev after the deploy
### H. Small fixes
- [ ] Study QC tiles: hide tiles with no data; "Per-sample QC metrics were not recorded for this study." when none

## Backlog / discovered
- Sync hazard: the HPC bot commits to GitHub `main` every 15 min and races Lovable's push. Move the bot to its own branch (or a data-only repo).
- Direct callers of `interpret-search-query` bypass the per-visitor budget (they are metered per IP instead). Add a shared secret between the Pages Function and the edge function once a Cloudflare env var can be set.
- Cell-type filter uses FTS on `{cell_type characteristics}` (prefix match); revisit if recall is a problem
- `gse_meta.year` is null for most studies; year facet is sparse until the ETL backfills it
- `meta_cache` rows refreshed lazily after 24h; an ETL hook could refresh them eagerly
- Study page: "Similar studies" strip; `/api/gsm/:id` should be edge-cached
- Account page: let signed-in users delete their account (profiles + usage rows) from the menu
- Accessibility pass (labels, teal focus rings, contrast) on the auth dialog, account menu and /account
