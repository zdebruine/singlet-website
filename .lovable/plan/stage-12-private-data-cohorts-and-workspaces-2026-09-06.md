# Stage 12 — Private data, cohorts and workspaces

## Goal
Add signed-in collaboration features without changing public catalog access or introducing billing language. Public studies remain open; private data is always filtered by the verified caller on the server. All limits are enforced server-side and repeated clearly in the interface and docs.

## 1. Data and access foundation
- Add a Lovable Cloud migration for projects, files, indexed private studies/samples/QC, cohorts/items/comments, workspaces/members/invites/activity, usage events and weekly-summary preferences.
- Add explicit grants, row-level security and helper functions for ownership, workspace membership, link visibility, API-key ownership, caps and aggregate usage. Roles live only in `workspace_members`, never profiles.
- Seed `catalog_version = 2026.09` in the existing D1 `meta_cache` table.
- Add the `USER_DATA` R2 binding in `wrangler.toml`; keep `package-lock.json` byte-identical.
- Verify browser sessions and API keys before any private lookup. Invalid or missing identity can never degrade into private access.

## 2. Private projects and files
- Build signed-in project CRUD with name, description, visibility, optional workspace, per-project read token and caps: 5 projects/account, 20 files/project, 10 GB/account, 2 TB global.
- Add resumable multipart upload endpoints: initiate, 50 MB parts, complete and abort/cleanup. Store objects only under `users/<uid>/projects/<pid>/...`; verify multipart ownership and declared size on every step.
- Validate `.singlet` zip64 structure by reading `manifest.json` through a URL-capable form of the Stage 8 range reader before accepting/indexing it. Add HTTPS URL registration with no stored bytes.
- Index manifest, study metadata, normalized vocabulary facets and per-sample `summary.json` QC into owner-scoped tables. Failed validation/indexing remains visible and never becomes searchable.
- Delete R2 objects, multipart state and database rows together. Friendly cap errors include current use and the applicable limit.
- Serve private whole-file and partial-file access through one-hour, HMAC-signed same-origin download URLs backed by the private R2 binding. This avoids exposing storage credentials while preserving expiring URL loading.

## 3. Browse, search and private study pages
- Add a signed-in “Mine” control to Browse and lock-marked private result cards; merge private results with public results using the Stage 11 match/score shape.
- Keep public search cache keys public-only. Private search is uncached and resolved only after verified user/key identity and workspace membership checks.
- Add `/p/:projectId/:study` with the existing study metadata, QC, provenance, file tree and partial-download presentation adapted to private IDs.
- Show the project loader URL and read token on the project page; never expose it in public search or page source.
- Extend MCP/API key identity to carry its owner. Add `include_private` to `search_datasets`, private IDs to `get_study`, and private file-aware download/QC behavior.

## 4. Cohorts
- Add “Save as cohort” from the current Browse query/filters/selection and manual cohort creation.
- Persist query, filters, explicit public/private study IDs, visibility, workspace and pinned catalog version.
- Add `/c/:id` with markdown notes, shared study cards, totals, manifest exports, “Open in Claude”, re-run diff, comments for workspace members and read-only link sharing.
- Add MCP `save_cohort` (key), `get_cohort`, and `cohort_id` support in `export_manifest`, with the same server-side visibility checks.

## 5. Workspaces
- Add workspace creation and `/w/:slug` for members, projects, cohorts and recent activity.
- Add 7-day single-use invite links and email-targeted invites that use the existing email sign-in flow.
- Enforce owner/member permissions, 25 members/workspace and 3 workspaces/user in server functions and UI. No SSO.

## 6. Account usage and weekly summaries
- Expand `/account` with AI searches today, MCP calls by tool this week, monthly downloads/partial downloads and GB, storage use, project/cohort counts, API keys and weekly-summary opt-in.
- Record API/MCP/download events with `waitUntil` so telemetry never delays responses; aggregate writes by day/tool to keep storage and write volume low.
- Add one restrained weekly summary template and an authenticated opt-in endpoint. Delivery uses the existing Cloud email integration; scheduling is isolated so it can run cheaply once weekly.

## 7. Documentation and language audit
- Add `/docs/private-projects`, `/docs/cohorts` and `/docs/workspaces`, linked from Docs and navigation where relevant.
- Update Quickstart step 4 to “Bring your own data”, including URL registration, loader lines, limits and MCP tools.
- Audit user-facing source for pricing, plan, billing, upgrade and tier language; use: “Free while in preview; limits shown on the page.”

## Technical details
- Pages Functions own R2 streaming/multipart operations; Lovable Cloud owns user-scoped relational data and email preferences.
- Private Pages endpoints call user-scoped database functions with the verified session/API-key owner. Security-definer functions expose only narrowly shaped operations and re-check membership internally.
- External URL registration accepts public HTTPS only, blocks credentials/private-network hosts and validates redirects to prevent SSRF.
- Markdown is rendered without raw HTML. Invite/read/download tokens are random, stored hashed, expire/revoke cleanly and are never logged.
- The global storage cap uses committed file bytes plus reserved multipart bytes to prevent concurrent uploads bypassing the limit.

## Verification
- Run migration through the managed migration flow, deploy required Cloud functions, then run `npm ci`, app build, Functions typecheck and focused tests; confirm `package-lock.json` unchanged.
- Browser-check desktop/mobile public and signed-in states, private non-leakage, caps, upload/register/index/delete, cohort sharing/export/diff/comments, workspace invites and account usage.
- After the Cloudflare deployment is live, use a throwaway account to run the requested GSE178957 URL registration and GSE103518 upload acceptance, API/MCP checks and signed-out checks; delete all throwaway objects/rows afterward.
- Report changed files, created tables, migration/function results and a redacted request/response transcript. If production deployment is not yet live, report that explicitly rather than claiming production verification.
