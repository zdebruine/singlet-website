/**
 * /browse state lives entirely in the URL query string so every view is a
 * shareable link and the back button works.
 *
 *   q            free text (plain English or keywords)
 *   mode         "ai" (default when q is set: the interpreter reads q)
 *                "filters" (the visitor edited the interpretation: the filters
 *                are theirs and q is plain keywords — same endpoint, no model)
 *   raw          original plain-English text kept for the search box once the
 *                user has edited the interpretation (mode=filters)
 *   level        gse (studies, default) | gsm (samples)
 *   organism, tissue_group, disease_group, assay_family, cell_type — repeatable
 *   min_cells, year_min, year_max, has_bundle (default 1 at both levels)
 *   sort, page, view (cards | table)
 */
import type { AppliedFilters, Level, SearchQuery, Sort } from "@/integrations/api/types";

export type View = "cards" | "table";
export type Mode = "ai" | "filters";

export const ARRAY_FIELDS = ["organism", "tissue_group", "disease_group", "assay_family", "cell_type"] as const;
export type ArrayField = (typeof ARRAY_FIELDS)[number];

export const SORTS: { value: Sort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "cells", label: "Most cells" },
  { value: "samples", label: "Most samples" },
  { value: "year", label: "Newest" },
  { value: "accession", label: "Accession" },
];

export const PAGE_SIZE = 20;

export interface BrowseState {
  q: string;
  raw: string;
  mode: Mode;
  level: Level;
  organism: string[];
  tissue_group: string[];
  disease_group: string[];
  assay_family: string[];
  cell_type: string[];
  min_cells: number | null;
  has_bundle: boolean;
  year_min: number | null;
  year_max: number | null;
  sort: Sort;
  page: number;
  view: View;
}

export const DEFAULT_STATE: BrowseState = {
  q: "",
  raw: "",
  mode: "ai",
  level: "gse",
  organism: [],
  tissue_group: [],
  disease_group: [],
  assay_family: [],
  cell_type: [],
  min_cells: null,
  has_bundle: true,
  year_min: null,
  year_max: null,
  sort: "relevance",
  page: 1,
  view: "cards",
};

function intOrNull(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function multi(sp: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  for (const v of sp.getAll(key)) {
    for (const part of v.split("|")) {
      const t = part.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function parseBrowseState(sp: URLSearchParams): BrowseState {
  const sortRaw = sp.get("sort") ?? "relevance";
  const sort = SORTS.some((s) => s.value === sortRaw) ? (sortRaw as Sort) : "relevance";
  const hb = sp.get("has_bundle");
  return {
    q: (sp.get("q") ?? "").trim(),
    raw: (sp.get("raw") ?? "").trim(),
    mode: sp.get("mode") === "filters" ? "filters" : "ai",
    level: sp.get("level") === "gsm" ? "gsm" : "gse",
    organism: multi(sp, "organism"),
    tissue_group: multi(sp, "tissue_group"),
    disease_group: multi(sp, "disease_group"),
    assay_family: multi(sp, "assay_family"),
    cell_type: multi(sp, "cell_type"),
    min_cells: intOrNull(sp.get("min_cells")),
    has_bundle: hb == null || hb === "" ? true : hb === "1" || hb === "true",
    year_min: intOrNull(sp.get("year_min")),
    year_max: intOrNull(sp.get("year_max")),
    sort,
    page: Math.max(1, intOrNull(sp.get("page")) ?? 1),
    view: sp.get("view") === "table" ? "table" : "cards",
  };
}

/** Serialize, omitting defaults so URLs stay short. */
export function serializeBrowseState(s: BrowseState): URLSearchParams {
  const sp = new URLSearchParams();
  if (s.q) sp.set("q", s.q);
  if (s.mode === "filters") sp.set("mode", "filters");
  if (s.raw && s.raw !== s.q) sp.set("raw", s.raw);
  if (s.level !== "gse") sp.set("level", s.level);
  for (const f of ARRAY_FIELDS) for (const v of s[f]) sp.append(f, v);
  if (s.min_cells != null) sp.set("min_cells", String(s.min_cells));
  if (!s.has_bundle) sp.set("has_bundle", "0");
  if (s.year_min != null) sp.set("year_min", String(s.year_min));
  if (s.year_max != null) sp.set("year_max", String(s.year_max));
  if (s.sort !== "relevance") sp.set("sort", s.sort);
  if (s.page > 1) sp.set("page", String(s.page));
  if (s.view !== "cards") sp.set("view", s.view);
  return sp;
}

export function browseHref(s: BrowseState): string {
  const qs = serializeBrowseState(s).toString();
  return qs ? `/browse?${qs}` : "/browse";
}

/** True when the request should go through the interpreter. */
export function isAiMode(s: BrowseState): boolean {
  return s.mode === "ai" && s.q !== "";
}

export function hasExplicitFilters(s: BrowseState): boolean {
  return (
    ARRAY_FIELDS.some((f) => s[f].length > 0) ||
    s.min_cells != null ||
    s.year_min != null ||
    s.year_max != null ||
    !s.has_bundle
  );
}

/** The API query for the current state. */
export function toSearchQuery(s: BrowseState, limit = PAGE_SIZE): SearchQuery {
  return {
    q: s.q || undefined,
    level: s.level,
    organism: s.organism,
    tissue_group: s.tissue_group,
    disease_group: s.disease_group,
    assay_family: s.assay_family,
    cell_type: s.cell_type,
    min_cells: s.min_cells ?? undefined,
    has_bundle: s.has_bundle,
    year_min: s.year_min ?? undefined,
    year_max: s.year_max ?? undefined,
    sort: s.sort,
    page: s.page,
    limit,
  };
}

/** The API query for the filters the server actually applied (drives facets). */
export function appliedToQuery(a: AppliedFilters, level: Level): SearchQuery {
  return {
    q: a.q || undefined,
    level,
    organism: a.organism,
    tissue_group: a.tissue_group,
    disease_group: a.disease_group,
    assay_family: a.assay_family,
    cell_type: a.cell_type,
    min_cells: a.min_cells ?? undefined,
    has_bundle: a.has_bundle ?? true,
    year_min: a.year_min ?? undefined,
    year_max: a.year_max ?? undefined,
  };
}

/**
 * Turn the server's applied filters into explicit URL state. Used the moment
 * a user edits an interpretation: from then on the filters are theirs.
 */
export function appliedToState(a: AppliedFilters, base: BrowseState): BrowseState {
  return {
    ...base,
    mode: "filters",
    raw: base.raw || base.q,
    q: a.q ?? "",
    organism: [...a.organism],
    tissue_group: [...a.tissue_group],
    disease_group: [...a.disease_group],
    assay_family: [...a.assay_family],
    cell_type: [...a.cell_type],
    min_cells: a.min_cells,
    has_bundle: a.has_bundle ?? base.has_bundle,
    year_min: a.year_min,
    year_max: a.year_max,
    page: 1,
  };
}

/** Parse a suggestion's canonical `params` string into state (keeps level/view/sort). */
export function stateFromParams(params: string, base: BrowseState): BrowseState {
  const parsed = parseBrowseState(new URLSearchParams(params));
  return {
    ...parsed,
    mode: "filters",
    raw: base.raw || base.q,
    level: base.level,
    view: base.view,
    sort: base.sort,
    page: 1,
  };
}

export const FIELD_LABEL: Record<string, string> = {
  organism: "Organism",
  tissue_group: "Tissue",
  disease_group: "Disease",
  assay_family: "Assay",
  cell_type: "Cell type",
  min_cells: "Min cells",
  year_min: "From",
  year_max: "To",
  q: "Keywords",
  has_bundle: "Downloadable",
  all_filters: "All filters",
};

export interface ActiveFilter {
  field: string;
  value: string;
  label: string;
}

/** Flatten applied filters into removable chips. */
export function activeFilters(a: AppliedFilters, organismLabel: (v: string) => string): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  for (const v of a.organism) out.push({ field: "organism", value: v, label: organismLabel(v) });
  for (const v of a.tissue_group) out.push({ field: "tissue_group", value: v, label: v });
  for (const v of a.disease_group) out.push({ field: "disease_group", value: v, label: v });
  for (const v of a.assay_family) out.push({ field: "assay_family", value: v, label: v });
  for (const v of a.cell_type) out.push({ field: "cell_type", value: v, label: v });
  if (a.min_cells != null) out.push({ field: "min_cells", value: String(a.min_cells), label: `≥ ${a.min_cells.toLocaleString()} cells` });
  if (a.year_min != null) out.push({ field: "year_min", value: String(a.year_min), label: `from ${a.year_min}` });
  if (a.year_max != null) out.push({ field: "year_max", value: String(a.year_max), label: `to ${a.year_max}` });
  if (a.q) out.push({ field: "q", value: a.q, label: `“${a.q}”` });
  return out;
}

/** Remove one filter atom from explicit state. */
export function withoutFilter(s: BrowseState, field: string, value: string): BrowseState {
  const next: BrowseState = { ...s, page: 1 };
  switch (field) {
    case "organism":
    case "tissue_group":
    case "disease_group":
    case "assay_family":
    case "cell_type":
      next[field] = s[field].filter((v) => v !== value);
      break;
    case "min_cells":
      next.min_cells = null;
      break;
    case "year_min":
      next.year_min = null;
      break;
    case "year_max":
      next.year_max = null;
      break;
    case "q":
      next.q = "";
      break;
    case "has_bundle":
      next.has_bundle = true;
      break;
  }
  return next;
}

export function toggleValue(s: BrowseState, field: ArrayField, value: string): BrowseState {
  const has = s[field].includes(value);
  return { ...s, page: 1, [field]: has ? s[field].filter((v) => v !== value) : [...s[field], value] };
}

/** The explicit part of the state, in the server's `applied` shape. */
export function stateToApplied(s: BrowseState): AppliedFilters {
  return {
    q: isAiMode(s) ? "" : s.q,
    organism: s.organism,
    tissue_group: s.tissue_group,
    disease_group: s.disease_group,
    assay_family: s.assay_family,
    cell_type: s.cell_type,
    min_cells: s.min_cells,
    has_bundle: s.has_bundle,
    year_min: s.year_min,
    year_max: s.year_max,
  };
}
