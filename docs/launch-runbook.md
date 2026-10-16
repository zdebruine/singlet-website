# Launch runbook

Everything here is a step that needs a person with access to Cloudflare, GitHub or the clusters. The code changes
are in the pull requests; this file is the order to do the rest in, and how to undo it.

## 0. Before merging anything

| Step | Command or place | Why |
|---|---|---|
| Set `INGEST_TOKEN_SHA256` (Production **and** Preview) | Pages → singlet → Settings → Variables and Secrets | The baked-in fallback digest is gone: unset means every ingest and crank call gets 401. Accepts several comma-separated digests for rotation. |
| Add GitHub secret `SINGLET_INGEST_TOKEN` | repo Settings → Secrets → Actions | `catalog-crank.yml` now sends it. It is the plaintext whose SHA-256 is `INGEST_TOKEN_SHA256`. |
| Apply `schema/012_ai_budget.sql` | `npx wrangler d1 execute singlet-catalog --remote --file=schema/012_ai_budget.sql` | AI calls refuse (fail closed) and MCP counters are not recorded until the tables exist. Idempotent. |
| Set `ANON_IP_SALT` (secret, any long random string) | Pages → Variables and Secrets | Anonymous visitors are keyed by a salted hash of their address; the default salt is public, so without this the hashes can be reversed. Changing it resets anonymous allowances. |
| Choose the AI caps | Pages variables `AI_MONTHLY_CAP_USD` (default 1), `AI_GLOBAL_MONTHLY_CAP_USD` (default 50), `AI_ANON_MONTHLY_CAP_USD` (default 0.02) | Users only ever see tokens. The global cap is the circuit breaker: pick a number you can afford. |
| Check the model price table | `functions/_shared/spend.ts` (`ANTHROPIC_PRICES`, `WORKERS_AI_PRICES`) | Prices were taken from the provider pages on 2026-10-16. An unlisted model is priced high; override with `AI_PRICE_IN_USD_PER_M` / `AI_PRICE_OUT_USD_PER_M`. |

## 1. After the first deploy

1. Hit any API route once (it creates `gse_meta.n_usable_cells`), then run
   `npx wrangler d1 execute singlet-catalog --remote --file=schema/013_usable_cells.sql`.
2. `bash scripts/smoke.sh https://singlet.bio`, then compare `/api/stats` with `/api/search?limit=1`:
   `studies_with_files` must equal `totals.studies`, `samples_in_files` `totals.samples`, `cells_in_files` `totals.cells`.
3. Open the home page, About (the "Where every sample stands" table adds up), and a study page.
4. In the browser console, check there are no Content-Security-Policy-Report-Only violations for a week, then move
   the report-only policy in `public/_headers` into the enforced one.

## 2. Cloudflare settings that code cannot make

### data.singlet.bio (R2 bucket `singlet-data`)

Browsers cannot read these files from another origin until CORS is set. Save as `cors.json`:

```json
{
  "rules": [
    {
      "allowed": { "origins": ["*"], "methods": ["GET", "HEAD"], "headers": ["Range", "If-None-Match", "If-Modified-Since"] },
      "exposeHeaders": ["Content-Range", "Content-Length", "Accept-Ranges", "ETag", "Last-Modified"],
      "maxAgeSeconds": 86400
    }
  ]
}
```

```bash
npx wrangler r2 bucket cors set singlet-data --file cors.json
npx wrangler r2 bucket cors list singlet-data     # confirm what was stored
```

Add a Transform Rule (Rules → Transform Rules → Modify Response Header) for hostname `data.singlet.bio`:
`X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=31536000`,
`Cache-Control: public, max-age=3600` for `*.singlet` (the files are replaced in place when a study is re-packed,
so keep this short).

### Zone

- SSL/TLS → Edge Certificates: Always Use HTTPS on; HSTS on (max-age 12 months, no preload yet).
- Redirect `www.singlet.bio/*` to `https://singlet.bio/$1` (301), so there is one canonical host.

### Rate limiting (Security → WAF → Rate limiting rules)

The code limits MCP to 60 calls a minute per key and meters AI, but cheap public reads still cost D1 reads.

| Rule | Match | Limit |
|---|---|---|
| MCP | URI path equals `/mcp` | 120 requests / 1 min per IP |
| AI search and explain | URI path in `/api/nl-search`, `/api/explain` | 30 / 1 min per IP |
| Bundle reads | URI path starts with `/api/bundle/` | 60 / 1 min per IP |
| Catalog reads | URI path starts with `/api/` | 600 / 1 min per IP |

Action: block for 1 minute for each.

## 3. The clusters (Purdue ANVIL and Clipper)

Two bots (`ANVIL Bot`, `Singlet Job-Orchestrator`) push to `main` every few hours, and a GitHub workflow
(`dashboard-refresh.yml`) logs in to Clipper by SSH. Nothing should be doing either while no campaign runs.

1. Log in (ACCESS/Duo) and look: `squeue -u $USER`, `crontab -l`, `systemctl --user list-timers`,
   `ps -u $USER -o pid,etime,cmd | grep -i -E "orchestr|anvil|dashboard"`, `ls ~/.config/systemd/user`.
2. Stop and disable what you find: `crontab -r` (after saving `crontab -l > ~/crontab.bak`),
   `systemctl --user disable --now <unit>`, `scancel -u $USER` only for jobs you recognise.
3. Remove the credentials the bots used to push: any `~/.git-credentials`, deploy keys in `~/.ssh`, and a
   `GITHUB_TOKEN`/PAT in the environment files of the units. Revoke the token on GitHub.
4. In the website repo, set the variable `DASHBOARD_REFRESH_ENABLED` to `false`
   (`gh variable set DASHBOARD_REFRESH_ENABLED --body false`) and delete the `CLIPPER_SSH_KEY` secret.
5. Rotate `SINGLET_INGEST_TOKEN` (new token → new digest next to the old one in `INGEST_TOKEN_SHA256`, then drop the old one).

## 4. GitHub

- Branch protection on `main` (website and Singlet-Bio/singlet): require a pull request and the `CI` check; no force pushes.
  `gh api -X PUT repos/zdebruine/singlet-website/branches/main/protection --input protection.json` with
  `{"required_status_checks":{"strict":true,"contexts":["build"]},"enforce_admins":false,"required_pull_request_reviews":{"required_approving_review_count":0},"restrictions":null}`
  (check the job name in `.github/workflows/ci.yml`; do this after step 3 so the bots stop failing noisily).
- Move or delete the old `v1.0.0` tag on Singlet-Bio/singlet before tagging the 1.0.0 release.

## 5. alpha.singlet.bio

Pages already builds every non-`main` branch at `https://<branch>.singlet-4gc.pages.dev`, so a branch named
`alpha` is live at `https://alpha.singlet-4gc.pages.dev` as soon as it is pushed. To serve it under the
singlet.bio name (custom domains can only be attached to production):

1. DNS: add a proxied `CNAME alpha → alpha.singlet-4gc.pages.dev`.
2. Rules → Origin Rules: when hostname equals `alpha.singlet.bio`, override the **Host header** and the
   **SNI** to `alpha.singlet-4gc.pages.dev`.
3. Add `https://alpha.singlet.bio` to the OAuth callbacks (GitHub and Google apps) and to `SITE_ORIGIN_RE` in
   `functions/_shared/identity.ts` (already there).

**Previews share the production D1 database.** For alpha, create `singlet-catalog-alpha`
(`wrangler d1 create singlet-catalog-alpha`, then `wrangler d1 export singlet-catalog --remote` and `import` into it)
and bind it as `DB` for the Preview environment, so migrations and the AI budget tables can be tried without
touching production. Apply `schema/010`–`013` there first.

## 6. Rollback

- Pages: Deployments → pick the last good production deployment → Rollback. Code only; D1 changes are additive.
- `schema/012` and `013` add tables and one column; leaving them in place is harmless to old code.
- If AI or MCP must be switched off at once: set `AI_GLOBAL_MONTHLY_CAP_USD` to `0.000001` (AI refuses, vocabulary
  search keeps working) and add a rate-limit rule blocking `/mcp`.
