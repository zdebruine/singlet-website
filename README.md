# singlet.bio

Website and catalog API for the **singlet** atlas — every public single-cell RNA-seq study on GEO, reprocessed the same way, one `.singlet` file per study. Data is CC0, code is MIT.

```bash
pip install singlet
```

```r
install.packages("singlet")
# Until CRAN accepts the release: remotes::install_github("Singlet-Bio/singlet", subdir = "r")
```

```python
import singlet
adata = singlet.load("GSE178957")
```

## What is in this repository

| Path | Purpose |
|------|---------|
| `src/` | React 18 + TypeScript + Vite + Tailwind front end (home, `/browse`, `/docs`, `/about`, `/study/:gse`) |
| `functions/api/` | Cloudflare Pages Functions — the catalog API (`/api/search`, `/api/facets`, `/api/nl-search`, `/api/gse/:id`, `/api/stats`) backed by D1 |
| `functions/_shared/` | Shared helpers: edge caching, controlled vocabulary normalizer, condition summariser, suspect-cell guard |
| `supabase/functions/` | Lovable Cloud edge functions (AI query interpretation) |
| `schema/` | D1 schema and local seed scripts |
| `public/` | Static assets, `_redirects`, sitemap |

## Development

```bash
npm install
npm run dev        # Vite on :8080, /api/* proxied to https://singlet.bio
```

Set `VITE_API_PROXY_TARGET` to point the dev proxy at another API host.

## Deployment

Cloudflare Pages project `singlet`, auto-deployed from `main`. The D1 database `singlet-catalog` is bound as `DB`; study bundles live in the public R2 bucket at `https://data.singlet.bio`.

## Related

- [Singlet-Bio/singlet](https://github.com/Singlet-Bio/singlet) — Python and R client packages
