# Copilot Instructions

## Repository Overview

`singletai-website` is the React + TypeScript website for SingletDB (singletdb.com). Part of [Singlet AI](https://github.com/Singlet-AI).

## Large File Creation

When creating files larger than ~200 lines, break into phases of ≤200 lines each.

## Project Structure

- **Website:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
  - `src/pages/` — Page components (18 pages)
  - `src/pages/invest/` — 8 investor subsections with scrollspy
  - `src/components/` — Shared components (Navbar, Footer, ui/)
  - `src/hooks/` — Custom hooks (useAuth, useScrollspy)
  - `src/integrations/supabase/` — Supabase client + types
  - `src/assets/` — Images (team photos, etc.)
- **Docs:** `docs/` — Sphinx operational documentation (furo theme)

## Website Patterns

- Pages use shadcn/ui components, Lucide icons, Tailwind CSS
- Invest subpages follow scrollspy sidebar + section pattern
- Math rendering: use KaTeX with `react-katex` or inline rendering
- Expandable sections: use Collapsible from shadcn/ui or accordion
- Code blocks: copy-to-clipboard, Python/R highlighting
- Pro features marked with Crown icon

## Related Repositories

- [singlet](https://github.com/Singlet-AI/singlet) — Python client documented on site
- [singlepress](https://github.com/Singlet-AI/singlepress) — Compression format featured on site
- [geo-reprocess](https://github.com/Singlet-AI/geo-reprocess) — Pipeline powering data
- [singlet-intelligence](https://github.com/Singlet-AI/singlet-intelligence) — ML models featured
- [singlet-strategy](https://github.com/Singlet-AI/singlet-strategy) — Strategy informing content
