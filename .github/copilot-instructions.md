# Copilot Instructions

## Repository Overview

`singlet-website` is the website, API and MCP server behind [singlet.bio](https://singlet.bio), a catalog of re-processed public GEO single-cell RNA-seq studies. It runs entirely on Cloudflare: Pages (static SPA), Pages Functions (API + MCP), D1 (catalog, accounts, private projects), R2 (data files) and Workers AI.

## Large File Creation

When creating files larger than ~200 lines, break into phases of ≤200 lines each.

## Project Structure

- **Website:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
  - `src/pages/` — page components
  - `src/components/` — shared components (Navbar, Footer, auth/, browse/, study/, ui/)
  - `src/integrations/api/` — typed client for the Pages Functions API (`client.ts`, `types.ts`)
  - `src/lib/`, `src/hooks/` — helpers and hooks
- **API:** `functions/` — Cloudflare Pages Functions (strict TypeScript, `tsconfig.functions.json`)
  - `functions/api/` — catalog, search, accounts, API keys, private projects
  - `functions/auth/` — GitHub / Google OAuth sign-in
  - `functions/mcp.ts` — MCP server; `functions/_shared/` — shared modules
- **Database:** `schema/` — D1 schema files, applied with `wrangler d1 execute singlet-catalog --remote --file=…`

## Website Patterns

- Pages use shadcn/ui components, Lucide icons, Tailwind CSS
- Math rendering: use KaTeX
- Expandable sections: use Collapsible from shadcn/ui or accordion
- Code blocks: copy-to-clipboard, Python/R highlighting
- No Supabase or Lovable dependencies: every backend feature is a Pages Function on D1/R2
