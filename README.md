# singlet.bio

Website, catalog API and MCP server for the **singlet** atlas — every public single-cell RNA-seq study on GEO, reprocessed the same way, one `.singlet` file per study. Data is CC0, code is MIT.

```bash
pip install git+https://github.com/Singlet-Bio/singlet
```

```r
install.packages("remotes")
remotes::install_github("Singlet-Bio/singlet", subdir = "r")
```

```python
import singlet
adata = singlet.load("GSE138867")
```

The install commands shown on the site come from one file, `src/lib/install-snippets.ts`; when the PyPI / CRAN releases land, change the two constants there.

Questions and bugs: [GitHub Issues](https://github.com/Singlet-Bio/singlet/issues).

## Architecture

Everything runs on Cloudflare; there is no other backend.

| Piece | What |
|------|---------|
| Pages | Project `singlet` serves the Vite build of `src/` (React 18 + TypeScript + Tailwind + shadcn/ui) from `dist/` |
| Pages Functions | `functions/api/*` (catalog, search, accounts, API keys, private projects), `functions/auth/*` (GitHub / Google sign-in), `functions/mcp.ts` (MCP server), shared code in `functions/_shared/` |
| D1 | `singlet-catalog`, bound as `DB`: the catalog, plus users, sessions, API keys, daily AI budgets, AI caches and private projects |
| R2 | `singlet-data` (public, `https://data.singlet.bio`, study bundles) and `singlet-user-data` (private uploads, bound as `USER_DATA`) |
| Workers AI | bound as `AI`, called through AI Gateway `AI_GATEWAY_ID`: interprets search questions the built-in vocabulary cannot read, and writes result explanations. Set `ANTHROPIC_API_KEY` to use the Anthropic API instead |

Sign-in is optional (browsing, search and downloads never need it). GitHub and Google OAuth run in Pages Functions (`functions/_shared/oauth.ts`); both apps use the callback `https://singlet.bio/auth/<provider>/callback`, and sign-ins started on a preview are relayed back to it. Sessions are an HttpOnly cookie backed by D1. Signed-in visitors get 200 AI searches a day instead of 10, 100 AI explanations, API keys (`sk_live_…`, only a SHA-256 hash is stored) and private projects, cohorts and workspaces.

## Development

```bash
npm ci
npm run dev        # Vite on :8080, /api/* proxied to https://singlet.bio
npm test           # vitest
```

Set `VITE_API_PROXY_TARGET` to point the dev proxy at another API host. `npm run build` runs the same gate Cloudflare runs: vitest, the strict Functions typecheck, the Functions bundle, then `vite build`. Sign-in needs the Functions running locally (`npx wrangler pages dev dist` after a build).

## Deployment

Cloudflare Pages auto-deploys `main` to singlet.bio; every other branch builds at `https://<branch>.singlet-4gc.pages.dev`. Cloudflare runs `npm ci`, so `package.json` and `package-lock.json` must stay in sync: the **Regenerate package-lock.json** workflow (`.github/workflows/lockfile.yml`) commits a fresh lockfile to a branch, by hand or automatically when a push to a non-main branch changes `package.json`. CI (`.github/workflows/ci.yml`) runs the same build on every PR.

D1 schema files are idempotent and applied once:

```bash
npx wrangler d1 execute singlet-catalog --remote --file=schema/010_accounts.sql
npx wrangler d1 execute singlet-catalog --remote --file=schema/011_product.sql
```

Variables (`wrangler.toml` `[vars]`): `GITHUB_CLIENT_ID`, `AI_MODEL`, `AI_GATEWAY_ID`.

Secrets (Pages → singlet → Settings → Variables and Secrets, for Production and Preview):

| Secret | Needed for |
|--------|-----------|
| `GITHUB_CLIENT_SECRET` | GitHub sign-in |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `ANTHROPIC_API_KEY` | optional: Anthropic instead of Workers AI |
| `INGEST_TOKEN_SHA256` | sha256 of the HPC ingest token (`/api/ingest/*`) |

A provider whose secrets are missing shows as unavailable in the sign-in dialog; with no AI provider, search falls back to the built-in vocabulary.

## MCP server

`https://singlet.bio/mcp` (Streamable HTTP, stateless JSON-RPC 2.0) has 14 tools: `search_datasets`, `get_study`, `get_download_url`, `get_atlas_stats`, `get_sample_qc`, `list_bundle_files`, `get_modalities`, `get_partial_download`, `export_manifest`, `find_matched_controls`, `compare_studies`, `assess_study`, `get_cohort` and `save_cohort`.

Most tools need no key. Only `search_datasets` is metered, and only when a question needs a fresh AI reading (10 a day anonymously, 200 with a key). `save_cohort` needs a personal API key, and so does `get_cohort` except for a link cohort opened with its share token. Keys go in `Authorization: Bearer sk_live_…` or `X-API-Key` and are charged to their owner. Client configs are documented at `/docs/mcp`.

## Related

- [Singlet-Bio/singlet](https://github.com/Singlet-Bio/singlet) — Python and R client packages
