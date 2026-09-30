# Copilot Instructions

## Repository overview

The website and API for [singlet.bio](https://singlet.bio): a catalog of public GEO single-cell RNA-seq studies, reprocessed from raw reads, one `.singlet` file per study. Deployed on Cloudflare Pages; `main` auto-deploys.

## Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui in `src/` (pages in `src/pages/`, shared components in `src/components/`, API client in `src/integrations/api/`).
- **API and MCP server:** Cloudflare Pages Functions in `functions/` (`functions/api/*`, `functions/mcp.ts`, shared logic in `functions/_shared/`).
- **Data:** Cloudflare D1 (binding `DB`, the catalog) and R2 (`.singlet` files served from `data.singlet.bio`; private user files on the `USER_DATA` binding).
- Do not add Supabase or Lovable dependencies; the target is Cloudflare only.

## Build and checks

- `npm run build` runs `prebuild` first: vitest, a strict typecheck of `functions/` (`tsconfig.functions.json`), and a `wrangler pages functions build`. A type error in `functions/` fails the production deploy even though Pages reports the static assets as deployed.
- `npm run dev` serves the SPA; `scripts/dev-api/` runs the Functions locally against a seeded SQLite catalog.

## Conventions

- Copy is short and factual; no claims the data can't support (pipeline versions differ between files, input is capped at 30M reads per sample).
- Install commands come from `src/lib/install-snippets.ts`; never print a bare PyPI install line.
- In R snippets use `singlet::load()` / `singlet::find()` (the package masks `base::load` and `utils::find`).
- Keep shell commands and Python in separate code blocks.

## Related repositories

- [Singlet-Bio/singlet](https://github.com/Singlet-Bio/singlet) — the C++ pipeline and the Python and R clients.
