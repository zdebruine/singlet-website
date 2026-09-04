# singlet.bio rebuild — roadmap

## Stage 1 (this run): design system, logo, IA, home, docs, about, dead-page removal
- [ ] Design system tokens (index.css + tailwind.config.ts + shadcn button/badge)
- [ ] Logo component (light/dark), favicon, OG image
- [ ] Navbar (Browse · Docs · About the data · GitHub · compact search · Sign in placeholder)
- [ ] Footer (dark, single row)
- [ ] Home page (hero search, examples, live stats, start tiles, Python/R cards)
- [ ] Docs page (consolidated, sidebar sections, corrected snippets)
- [ ] About the data page
- [ ] Browse re-skin (no tiers, processed/failed, /study links, AI violet chips)
- [ ] Study page at /study/:gse (re-skin only), /series → /study redirect, #gsm anchor
- [ ] /sample/:gsm → /study/<gse>#<gsm> redirect via API lookup
- [ ] Route redirects: /download, /docs/access, /byod, /pipeline, /notebooks, /benchmarks, /blog
- [ ] Remove dead pages/components/hooks; update sitemap + index.html head
- [ ] Verify: build passes, redirects work, screenshots of /, /browse, /docs, /about, /study

## Stage 2 (next): search + browse on gse_meta rollups
- /api/facets?level=gse (study-level counts by organism_primary / tissue_group / disease_group / assay_family) so home tiles can show study counts
- Browse rewrite: study-level results, tissue_group / disease_group / assay_family filters, AI interpretation on `q`
- Organism display names (scientific → common) end-to-end

## Stage 3: study page
## Stage 4: accounts / sign in
