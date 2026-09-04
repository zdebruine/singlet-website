# singlet.bio

Website and catalog API for the **singlet** atlas — every public single-cell RNA-seq study on GEO, reprocessed the same way, one `.singlet` file per study. Data is CC0, code is MIT.

```bash
pip install git+https://github.com/Singlet-Bio/singlet
```

```r
install.packages("remotes")
remotes::install_github("Singlet-Bio/singlet", subdir = "r")
```

```python
import singlet
adata = singlet.load("GSE178957")
```

The install commands shown on the site come from one file, `src/lib/install-snippets.ts`; when the PyPI / CRAN releases land, change the two constants there.

Questions and bugs: [GitHub Issues](https://github.com/Singlet-Bio/singlet/issues).

## What is in this repository

| Path | Purpose |
|------|---------|
| `src/` | React 18 + TypeScript + Vite + Tailwind front end (home, `/browse`, `/docs`, `/about`, `/study/:gse`) |
| `functions/api/` | Cloudflare Pages Functions — the catalog API (`/api/search`, `/api/facets`, `/api/nl-search`, `/api/gse/:id`, `/api/stats`) backed by D1 |
| `functions/mcp.ts` | Hosted MCP server (`https://singlet.bio/mcp`, Streamable HTTP, stateless JSON-RPC 2.0; tool calls need an API key) |
| `functions/_shared/` | Shared helpers: edge caching, controlled vocabulary normalizer, condition summariser, suspect-cell guard, visitor identity / API-key validation |
| `supabase/functions/` | Lovable Cloud edge functions (AI query interpretation, match explanations, API-key management) |
| `schema/` | D1 schema and local seed scripts |
| `public/` | Static assets, `_redirects`, sitemap |

## Development

```bash
npm install
npm run dev        # Vite on :8080, /api/* proxied to https://singlet.bio
```

Set `VITE_API_PROXY_TARGET` to point the dev proxy at another API host.

## Deployment

Cloudflare Pages project `singlet`, auto-deployed from `main` (every branch also builds at `https://<branch>.singlet-4gc.pages.dev`). Cloudflare runs `npm ci`, so `package.json` and `package-lock.json` must stay in sync. The D1 database `singlet-catalog` is bound as `DB`; study bundles live in the public R2 bucket at `https://data.singlet.bio`.

Pages Functions read these environment variables (all non-secret): `SUPABASE_URL` and `SUPABASE_ANON_KEY` (defaults are compiled in) for the Lovable Cloud calls that interpret searches and validate API keys.

## Accounts, API keys and MCP

- Sign-in (Google, GitHub, email link) is handled by Lovable Cloud auth. It is optional and only raises the AI-search allowance (10/day anonymous → 200/day signed in).
- `/account` lets a signed-in user create and revoke API keys (`sk_live_…`). Only a SHA-256 hash and the first 8 characters are stored (`api_keys` table; writes go through the `api-keys` edge function).
- The catalog API accepts `Authorization: Bearer sk_live_…` or `X-API-Key`; requests are charged to the key's owner. Validation is cached 60 s per isolate and `last_used_at` is touched at most every 5 minutes.
- `/mcp` exposes `search_datasets`, `get_study`, `get_download_url` and `get_atlas_stats`. Client configs are documented at `/docs#api-keys`.

## Related

- [Singlet-Bio/singlet](https://github.com/Singlet-Bio/singlet) — Python and R client packages
