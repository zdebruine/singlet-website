# Stage 11 — Ranked search and browse experience

## Goal
Make broad biological questions useful without weakening anything the researcher explicitly chose. Interpreted concepts become weighted evidence, while accessions, organisms, and rail filters remain strict constraints. The same ranking and evidence will drive the website API, MCP search, and matched-control selection.

## Search and ranking
- Introduce one study scoring engine in `search-core` that accepts separate hard filters and soft interpreted signals.
- Keep explicit accessions, interpreted organism, and every URL/rail filter hard. Score tissue, disease, cell type coverage, assay, residual keyword locations, file availability, file sample count, and recency exactly with the supplied weights.
- Expand residual terms conservatively using existing vocabulary rules plus singular/plural and hyphen/space variants. Synonyms affect evidence only and never broaden a hard constraint.
- Enrich candidate studies in bounded SQL passes with file metadata and per-study sample evidence, compute deterministic score/match/why output, apply the requested threshold, cap at 200, and order by score then file sample count.
- Return `groups.full` and `groups.partial` counts while retaining the flat `data` and `accessions` contracts used by clients. Every study gets facet and keyword evidence plus a score and deterministic explanation.
- Apply the scorer to keyword `/api/search`, interpreted `/api/nl-search`, MCP `search_datasets`, and `find_matched_controls` with healthy/control forced as a hard disease condition.

## Filters and facets
- Extend shared request types, parsing, canonical cache keys, normalization, and hard-filter SQL for file sample count, file-QC cell sum, reference build, normalized protocol, PubMed presence, maximum file size, conditions, and per-facet Any/All modes.
- Add guarded once-per-isolate indexes for study year, bundle sample/reference fields, and sample QC study/protocol fields.
- Extend `/api/facets` with contextual counts for all new facets, year histogram/range metadata, and other-filter semantics. Keep D1 statements at no more than four UNION terms and run them in one batch.
- Version the daily unfiltered `meta_cache` key so the expanded response is precomputed lazily and refreshed after ingest; filtered responses remain edge cached by canonical state.
- Normalize file protocol labels into `10xv2`, `10xv3`, `10x 5'`, `multiome`, and `other` consistently in filtering and facet counts.

## Browse experience
- Extend URL-owned browse state for every new value and Any/All mode, preserving shareable links and back/forward behavior.
- Rebuild the filter rail with a year histogram and dual range control, searchable long lists, per-facet Clear, Any/All controls, and locally remembered collapsed sections after the first four.
- Present the rail as a true drawer below 1024px with a `Filters (N)` trigger and accessible close/focus behavior.
- Keep violet interpreted chips editable; add “Make this a filter” so one interpreted soft signal becomes a hard URL filter without changing the others.
- Add Best match, Newest, Most samples, Most cells (file), Smallest file, and Alphabetical sorting. Best match preserves full/partial sections; alternate sorts produce one list.
- Update cards to one primary linked surface with the requested metadata, file-vs-catalog labels, evidence chips, muted explanation, and a focus/hover loader-copy action.
- Show full and partial section headings and divider, result count plus request time, and 25-result progressive loading with “Showing 1–25 of N”. Keep partial results visible in zero-full-match cases alongside remove-one-filter suggestions.

## Compatibility and validation
- Keep sample-level search behavior working while applying the new study ranking to GSE results.
- Update API client normalization/types and MCP structured/text responses additively so package and export consumers keep their existing fields.
- First clear the two inherited Stage 10 typecheck blockers (Logo prop compatibility and URLSearchParams iteration) without changing user behavior.
- Preserve `package-lock.json` byte-for-byte. Run `npm ci && npm run build`, app typecheck, Functions typecheck, and relevant local endpoint tests.
- Verify desktop and mobile browse interactions, URL round-trip, Any/All tissue behavior, grouped cards, and console/network cleanliness locally.
- After deployment, run the six requested production queries and the combined human/lung/year/protocol filter; report trimmed response shapes, timings, group counts, changed files, and any data-dependent deviations from expected counts.

## Technical notes
- Candidate retrieval will use FTS OR scope for soft text evidence, then exact per-study scoring; hard constraints stay in SQL before scoring.
- Pagination will operate over the ranked capped set, with cumulative 25-row client loading. Non-relevance sorts still use the same thresholded candidate set but flatten group presentation.
- File-cell totals come only from `sample_qc`; missing values remain unknown and are never replaced with catalog counts without an explicit label.
- Assumption: Any/All applies to organism, tissue, disease, assay, cell type, reference build, and protocol; Any remains the default.
