# Stage 10 — Brand system and whole-site propagation

## Goal
Replace the current visual system with the specified IBM Plex, flat-teal singlet.bio brand across every public and account view, while preserving all search, bundle, QC, export, MCP, auth, and download behavior.

## Implementation

1. **Create the brand foundation**
   - Add `src/styles/tokens.css` as the single source of truth for the full light/dark palettes, type scale, spacing, radii, focus, and overlay shadow tokens, including system dark mode and explicit `[data-theme]` overrides.
   - Load IBM Plex Sans and IBM Plex Mono from Google Fonts in the document head; remove Inter, Space Grotesk, JetBrains Mono, cyan, gradients, and component-level hex colors.
   - Map Tailwind semantic colors and font families to the new variables, and update shared controls, surfaces, chips, tables, prose, loading, empty, and error treatments.

2. **Generate and install the complete logo asset set**
   - Add the supplied `brand/gen.py`, download the OFL IBM Plex font releases into temporary build folders, and generate the outlined SVG marks, wordmarks, lockups, stacked marks, favicon, avatar, and default social image under `public/brand`.
   - Rasterize the required favicon/app/Apple/OG/lockup PNG and ICO files without adding a package dependency, then add the web manifest and update head icons, theme colors, and social image tags.
   - Rebuild `<Logo>` with the requested `variant`, `theme`, and `height` API, inline paths for theme-aware rendering, and apply it to the navbar, footer, sign-in, callback, 404, and documentation headers.

3. **Propagate the system through shared UI**
   - Standardize buttons, inputs, search, chips, tables, dialogs, popovers, code blocks, focus, disabled/loading states, skeletons, exact-reason error cards, and empty states.
   - Add `/` search focus, Escape clearing, keyboard result navigation, sticky table headers, tabular numeric typography, reduced-motion handling, and accessible labels.
   - Preserve one primary action per view and all existing Stage 8/9 behavior.

4. **Polish every requested page**
   - Update the navbar/mobile drawer and footer structure and links.
   - Recompose the home page around the display search, examples, hubs, three file-backed stats, and a three-step loader flow. The stats API will expose only observed bundle/QC totals: studies with files, samples represented in indexed files, and cells called in indexed file QC.
   - Restyle Browse and Study without removing facets, sorting, exports, selections, bundle/file QC, publication, citation, provenance, and related-study features; add explicit file-vs-catalog caveat styling.
   - Give Docs, Quickstart, About, and MCP docs a 66ch reading column with a sticky desktop table of contents and branded docs header.
   - Restyle Account, auth, errors, legal/reference pages, and remove commercial-plan wording from visible site copy.

5. **Add the brand reference page**
   - Add `/brand` and routing/navigation access with every logo form, light/dark examples, token swatches and hex values, type specimens, downloadable files, minimum-size/clear-space rules, prohibited treatments, and the CC0 data / MIT code note.

6. **Metadata and study social images**
   - Normalize titles to `<page> · singlet.bio` and use `/og-default.png` for default OG/Twitter cards.
   - Investigate a Pages-compatible PNG renderer for `/og/:gse.png` without changing the lockfile. If the existing runtime cannot render PNG safely without a new dependency, keep the default OG image and leave the requested TODO rather than shipping a fragile endpoint.

## Verification
- Keep `package-lock.json` byte-identical.
- Run `npm ci && npm run build` and the Pages Functions TypeScript check.
- Run source sweeps for obsolete fonts, gradients/cyan, component hex colors, and commercial-plan wording.
- Use Playwright at desktop and mobile widths to verify `/`, `/browse`, `/study/GSE296768`, `/docs`, `/docs/mcp`, `/quickstart`, `/about`, `/account`, and `/brand`; capture screenshots and check console errors, keyboard search, menus, and key table interactions.
- Check the current production deployment for the same routes once the new build is available; if deployment is still pending, report that separately rather than claiming production verification.
