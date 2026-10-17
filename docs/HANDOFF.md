# Handoff: what is left to take singlet.bio live

State on 2026-10-16. Everything below is on branches with open PRs; nothing is merged and singlet.bio still runs the old `main`.

| Repo | PR | CI |
|---|---|---|
| zdebruine/singlet-website | #7 (also pushed to branch `alpha`) | green, Cloudflare preview builds |
| Singlet-Bio/singlet | #4 | green except what the latest push is still running |
| zdebruine/singlet (legacy R) | #66 | green on Ubuntu, macOS, Windows |

## Already done for you (this session)
* Production D1 migrations 012 and 013 applied (spend tables, `n_usable_cells` backfilled).
* Branch protection on `main` in the website and Singlet-Bio repos (PR + `build` check, no force push).
* GitHub secret `SINGLET_INGEST_TOKEN` created in the website repo (value never printed). Its SHA-256 digest is
  `92cffe38c7f1c494c8cd564aa8b97869099bf34f441d2e03d537e498cf9973e8`.
* Pages **Preview**: `INGEST_TOKEN_SHA256` and `ANON_IP_SALT` set. Pages **Production**: `ANON_IP_SALT` set.
* R2 bucket `singlet-data` CORS: GET/HEAD with Range from singlet.bio, www, the alpha preview and localhost:8080;
  exposes Content-Length, Content-Range, Accept-Ranges and ETag.
* A throwaway test user and API key (see "Cleanup").

## Needs you, in this order

### 1. Production digest (one command, then merge)
Do this just before merging website #7, because the old code on `main` also reads this variable and the old
ingest poster would start getting 401s:
```bash
cd singlet-website
printf '%s' 92cffe38c7f1c494c8cd564aa8b97869099bf34f441d2e03d537e498cf9973e8 \
  | npx wrangler pages secret put INGEST_TOKEN_SHA256 --project-name singlet --env production
```
Anything that posts to `/api/ingest/*` (the Purdue jobs, the dashboard) must send the token behind this digest.
The plain token is only in the GitHub secret `SINGLET_INGEST_TOKEN`; to use a token you control, generate one,
store its SHA-256 here and the plain value in that secret:
```bash
T=$(python -c "import secrets;print(secrets.token_urlsafe(32))")
printf '%s' "$T" | gh secret set SINGLET_INGEST_TOKEN --repo zdebruine/singlet-website
printf '%s' "$T" | python -c "import sys,hashlib;print(hashlib.sha256(sys.stdin.read().encode()).hexdigest())" \
  | tr -d '\n' | npx wrangler pages secret put INGEST_TOKEN_SHA256 --project-name singlet --env production
```

### 2. Merge, in this order
1. Singlet-Bio/singlet #4 (client). Then, before tagging, move the old tag: `git push origin :refs/tags/v1.0.0`, then tag the new 1.0.0.
2. zdebruine/singlet-website #7. Pages redeploys; the new code needs the digest from step 1.
3. zdebruine/singlet #66 (legacy). It requires RcppML 1.0.0 from GitHub (`Remotes:` in DESCRIPTION); CRAN has 0.3.7.1,
   so the legacy package cannot go to CRAN until RcppML 1.0.0 is on CRAN.

After the website deploy, run the smoke test: `bash scripts/smoke.sh https://singlet.bio`. The daily crank workflow
(`catalog-crank.yml`) needs the GitHub secret from above.

### 3. Cloudflare dashboard (zone-level; the wrangler login here has no zone scopes)
* **Rate limiting rules** (Security → WAF → Rate limiting), per IP, 1 minute:
  `/mcp` 120 requests; `/api/nl-search` 30; `/api/explain` 30; `/auth/*` 20. Action: block for 1 minute.
* **HSTS**: SSL/TLS → Edge Certificates → HSTS: max-age 6 months, include subdomains, no preload yet.
* **www redirect**: Rules → Redirect Rules: `www.singlet.bio/*` to `https://singlet.bio/${1}` (301).
* **alpha.singlet.bio** (optional): a CNAME `alpha` to `alpha.singlet-4gc.pages.dev`, proxied, plus Pages → Custom domains.
  Previews share the production D1; give alpha its own database before pointing real traffic at it.

### 4. Sign in once on the new code
Open the alpha preview (or singlet.bio after merge), sign in with GitHub and Google, create a key under Account →
API keys. Nobody has signed in on the new code yet (the database has zero real users), so this is the one path I
could not exercise. If sign-in fails on the preview host, add `https://alpha.singlet-4gc.pages.dev` to the OAuth
apps' callback URLs.

## Try it from Claude (terminal)
```bash
cd C:\Users\zacha\Projects\singlet-website
export SINGLET_API_KEY=$(grep -o 'sk_live_[A-Za-z0-9]*' .env.local)     # the test key, valid until 2026-10-18 00:24 UTC
claude                                                                    # approve the "singlet-alpha" server from .mcp.json
```
Then ask: "Find human PBMC COVID-19 studies, show per-sample QC for GSE165080, and find matched controls."
With your own key later: `claude mcp add --transport http singlet https://singlet.bio/mcp --header "Authorization: Bearer sk_live_..."`.
Claude.ai: Settings → Connectors → Add custom connector → `https://singlet.bio/mcp?key=sk_live_...` (untested in that UI).

## Cleanup of the test credentials (run anytime; they expire on their own)
```sql
-- wrangler d1 execute singlet-catalog --remote --command "<this>"
DELETE FROM users WHERE id = 'e2e-claude-test';   -- cascades to its api_keys
DELETE FROM ai_spend WHERE subject = 'user:e2e-claude-test';
DELETE FROM mcp_usage WHERE subject = 'user:e2e-claude-test';
```
Also delete `singlet-website/.env.local` and `.mcp.json` (both untracked).

## Search quality and cost
`scripts/search-eval/README.md` explains the eval and shows the numbers. In short: production now uses Llama 4 Scout
(Workers AI) with a compact prompt: 940 input tokens and about 0.0003 USD per AI reading, against 2,190 tokens and
0.0008 USD before, with the same accuracy on the golden queries. Claude Haiku is used only if `ANTHROPIC_API_KEY` is set,
and costs several times more per token. About two thirds of queries never reach a model: the vocabulary parser answers them.

## Still open, none blocking
* Scan all 8,200 deployed bundles' `.1pz` headers for version != 1 before the strict reader reaches production (84 of 84 sampled were version 1).
* Playwright smoke specs; OAuth/upload/cohort tests; modality label fixes (`plate_scrna` on 10x); sitemap/manifest caching.
* Deferred by you: Purdue ANVIL / Clipper bots and `DASHBOARD_REFRESH_ENABLED`.
* PyPI and CRAN submissions (not before launch, per plan).
