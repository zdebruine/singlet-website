/**
 * /browse — find studies.
 *
 * One search bar. Whatever is typed goes to /api/nl-search, which reads plain
 * English, keywords and accessions. The interpretation comes back as chips;
 * editing a chip or a rail checkbox re-runs the same search with the adjusted
 * filters (URL state) and no second model call. Filter-only views (no text)
 * list studies through /api/search. AND across filter groups, any-of within a
 * group, never loosened silently.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LayoutGrid, List, Loader2, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { cn } from "@/lib/utils";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtCompact, fmtInt, organismLabel } from "@/lib/catalog-display";
import { searchDestination } from "@/lib/search-routing";
import { SEARCH_PLACEHOLDER } from "@/components/SearchBox";
import { apiClient, isApiError } from "@/integrations/api/client";
import type { AppliedFilters, NlSearchResponse, SampleRow, SearchResponse, Sort, StudyRow } from "@/integrations/api/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { AiQuotaBadge, AiQuotaExceeded } from "@/components/browse/AiQuotaNotice";
import {
  DEFAULT_STATE,
  PAGE_SIZE,
  SORTS,
  appliedToQuery,
  activeFilters,
  appliedToState,
  browseHref,
  hasExplicitFilters,
  isAiMode,
  parseBrowseState,
  serializeBrowseState,
  stateFromParams,
  stateToApplied,
  toSearchQuery,
  toggleValue,
  withoutFilter,
  type MultiField,
  type BrowseState,
  type View,
} from "@/components/browse/browse-state";
import { FilterRail } from "@/components/browse/FilterRail";
import { ActiveFiltersRow } from "@/components/browse/ActiveFiltersRow";
import { StudyCard, StudyCardSkeleton } from "@/components/browse/StudyCard";
import { StudyTable } from "@/components/browse/StudyTable";
import { SampleTable } from "@/components/browse/SampleTable";
import { SelectionBar } from "@/components/browse/SelectionBar";
import { EmptyState } from "@/components/browse/EmptyState";
import { ExportMenu } from "@/components/browse/ExportMenu";
import { useSelection } from "@/components/browse/useSelection";

type Result = SearchResponse | NlSearchResponse;

function isNl(r: Result | undefined): r is NlSearchResponse {
  return !!r && "interpreted" in r;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-2.5 text-[12.5px] font-medium transition-colors border-r border-border last:border-r-0",
            value === o.value ? "bg-secondary text-foreground" : "bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Browse = () => {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const state = useMemo(() => parseBrowseState(sp), [sp]);
  const aiMode = isAiMode(state);
  const stateKey = serializeBrowseState(state).toString();

  usePageMeta({
    title: state.q ? `${state.raw || state.q} — search` : "Browse studies",
    description: "Search every uniformly reprocessed public scRNA-seq study by organism, tissue, disease, assay, cell type, or in plain English.",
    path: "/browse",
    noindex: !!state.q || hasExplicitFilters(state),
  });

  const go = useCallback((next: BrowseState) => navigate(browseHref(next)), [navigate]);

  // ── Search input ──────────────────────────────────────────────────────────
  const [text, setText] = useState(state.raw || state.q);
  useEffect(() => setText(state.raw || state.q), [state.raw, state.q]);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) {
      go({ ...DEFAULT_STATE, level: state.level, view: state.view });
      return;
    }
    const dest = searchDestination(t);
    if (dest && !dest.startsWith("/browse")) {
      navigate(dest);
      return;
    }
    // A new question starts clean: the interpreter (or you, via the rail) adds filters back.
    go({ ...DEFAULT_STATE, q: t, level: state.level, view: state.view });
  };

  // ── Results ───────────────────────────────────────────────────────────────
  const query = useMemo(() => ({ ...toSearchQuery(state, Math.min(200, state.page * PAGE_SIZE)), page: 1 }), [state]);
  const result = useQuery<Result>({
    queryKey: ["browse", state.q ? (aiMode ? "nl" : "nl-edited") : "list", stateKey],
    queryFn: async ({ signal }) => {
      // Text always goes to the one search endpoint; `interpret: false` marks
      // a search whose filters the visitor has already edited.
      const res = state.q
        ? await apiClient.nlSearch({ ...query, q: state.q, interpret: aiMode }, signal)
        : await apiClient.search(query, signal);
      // Guard against an older API deployment (or a proxy pointing at one):
      // fail into the error state instead of crashing on a missing `applied`.
      if (!res || !Array.isArray(res.data) || !res.applied || !res.level) {
        throw new Error("The catalog API returned an unexpected response. It may be mid-deploy — try again in a minute.");
      }
      return res;
    },
    placeholderData: keepPreviousData,
    staleTime: 120_000,
    retry: 1,
  });
  const data = result.data;
  // While a new AI query is in flight, previous data belongs to another question.
  const fresh = data && !result.isPlaceholderData ? data : undefined;
  // Keep the previous page on screen while refreshing — unless it is the other
  // result level, in which case its totals/rows would be mislabelled.
  const shown = fresh ?? (data && data.level === state.level ? data : undefined);

  const applied: AppliedFilters = useMemo(() => fresh?.applied ?? stateToApplied(state), [fresh, state]);
  const appliedQuery = useMemo(() => appliedToQuery(applied, state.level), [applied, state.level]);
  const appliedKey = JSON.stringify(appliedQuery);

  const facets = useQuery({
    queryKey: ["facets", appliedKey],
    queryFn: ({ signal }) => apiClient.facets(appliedQuery, signal),
    enabled: !aiMode || !!fresh,
    placeholderData: keepPreviousData,
    staleTime: 300_000,
  });

  // ── Filter edits (the filters become the visitor's own from here on) ─────
  const explicitBase = useCallback((): BrowseState => {
    if (aiMode && fresh) return appliedToState(fresh.applied, state);
    return { ...state, page: 1 };
  }, [aiMode, fresh, state]);

  const onToggle = (field: MultiField, value: string) => go(toggleValue(explicitBase(), field, value));
  const onMode = (field: MultiField, mode: "any" | "all") => {
    const b = explicitBase();
    go({ ...b, match_mode: { ...b.match_mode, [field]: mode } });
  };
  const onAddCellType = (v: string) => {
    const b = explicitBase();
    if (b.cell_type.includes(v)) return;
    go({ ...b, cell_type: [...b.cell_type, v] });
  };
  const onMinCells = (n: number | null) => go({ ...explicitBase(), min_cells: n });
  const onYear = (min: number | null, max: number | null) => go({ ...explicitBase(), year_min: min, year_max: max });
  const onBundle = (only: boolean) => go({ ...explicitBase(), has_bundle: only });
  const onBoolean = (field: "has_pubmed" | "has_conditions", value: boolean | null) => go({ ...explicitBase(), [field]: value });
  const onRemove = (field: string, value: string) => go(withoutFilter(explicitBase(), field, value));
  const onClear = () => go({ ...DEFAULT_STATE, level: state.level, view: state.view });
  const setLevel = (level: "gse" | "gsm") => go({ ...state, level, page: 1, view: level === "gsm" ? state.view : state.view });
  const setView = (view: View) => go({ ...state, view });
  const setSort = (sort: Sort) => go({ ...state, sort, page: 1 });
  const setPage = (page: number) => {
    go({ ...state, page });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const applySuggestion = (params: string) => go(stateFromParams(params, state));

  // ── Selection ─────────────────────────────────────────────────────────────
  const selection = useSelection();
  const barRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [railOpen, setRailOpen] = useState(false);
  const focusRail = () => {
    setRailOpen(true);
    setTimeout(() => railRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  const studies = (shown?.level === "gse" ? (shown.data as StudyRow[]) : []) ?? [];
  const samples = (shown?.level === "gsm" ? (shown.data as SampleRow[]) : []) ?? [];
  const totals = shown?.totals;
  const total = shown?.total ?? 0;
  const canLoadMore = !!shown && shown.data.length < shown.total && shown.data.length < 200;
  const nl = isNl(fresh) ? fresh : undefined;
  const showAiRow = aiMode && !!nl?.interpreted;
  const quotaExceeded = !!nl?.quota_exceeded && !!nl.quota;
  const hasActive = !!fresh && (hasExplicitFilters(appliedToState(fresh.applied, state)) || !!fresh.applied.q);
  const loadingInitial = result.isLoading && !shown;
  const refreshing = result.isFetching && !!shown;
  const chipsApplied = fresh ? fresh.applied : applied;

  const exportHref = apiClient.exportAccessionsUrl(appliedQuery);

  // ── AI explanations (signed in) ───────────────────────────────────────────
  // One sentence per study from the model, replacing the rule-based "why".
  // Never automatic: each uncached batch spends one unit of the daily budget.
  const { user, openSignIn } = useAuth();
  const [explained, setExplained] = useState<{ key: string; map: Record<string, string> }>({ key: "", map: {} });
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const explanations = explained.key === stateKey ? explained.map : {};
  const pendingExplain = studies.filter((r) => !explanations[r.gse_id]);
  const canExplain = showAiRow && state.level === "gse" && studies.length > 0;

  const explain = async () => {
    if (!user) {
      openSignIn({ reason: "AI explanations are free with an account: one grounded sentence per study on why it does or doesn't answer your question." });
      return;
    }
    if (!pendingExplain.length || explaining) return;
    setExplaining(true);
    setExplainError(null);
    const key = stateKey;
    try {
      for (let i = 0; i < pendingExplain.length; i += 10) {
        const batch = pendingExplain.slice(i, i + 10);
        const r = await apiClient.explain(state.q, batch);
        setExplained((prev) => ({ key, map: { ...(prev.key === key ? prev.map : {}), ...r.explanations } }));
      }
    } catch (e) {
      if (isApiError(e) && e.status === 401) openSignIn();
      setExplainError(e instanceof Error ? e.message : "AI explanations are unavailable right now.");
    } finally {
      setExplaining(false);
    }
  };
  useEffect(() => setExplainError(null), [stateKey]);

  const explainButton = canExplain ? (
    <button
      type="button"
      onClick={explain}
      disabled={explaining || (!!user && pendingExplain.length === 0)}
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ai hover:underline underline-offset-2 disabled:opacity-60 disabled:no-underline"
      title={user ? "One grounded sentence per study, written by the model from its metadata. Costs one AI explanation per 10 studies; repeats are free." : "Sign in (free) to get AI explanations"}
    >
      {explaining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {explaining ? "Explaining…" : !user ? "Sign in for AI explanations" : pendingExplain.length === 0 ? "Explained" : `Explain ${pendingExplain.length === studies.length ? "matches" : `${pendingExplain.length} more`}`}
    </button>
  ) : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      {/* Sticky search */}
      <div className="sticky top-14 z-20 bg-background/95 backdrop-blur border-b border-border">
        <form onSubmit={submit} role="search" className="container-site py-3 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <label htmlFor="browse-search" className="sr-only">
              Search studies
            </label>
            <input
              id="browse-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={SEARCH_PLACEHOLDER}
              title={SEARCH_PLACEHOLDER}
              className="input h-10 pl-9 pr-3 text-[14px] [&::-webkit-search-cancel-button]:appearance-none"
            />
          </div>
          <button type="submit" className="btn-primary h-10 px-5">
            Search
          </button>
          <button
            type="button"
            className="btn-secondary h-10 px-3 lg:hidden"
            onClick={() => setRailOpen(true)}
            aria-expanded={railOpen}
            aria-controls="browse-filters"
          >
            <SlidersHorizontal size={15} />
            <span className="sr-only sm:not-sr-only">Filters ({activeFilters(chipsApplied, organismLabel).length})</span>
          </button>
        </form>
      </div>

      <main className="container-site flex-1 py-5 pb-40">
        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
          {/* Left rail */}
          {railOpen && <button type="button" aria-label="Close filters" className="fixed inset-0 z-30 bg-foreground/25 lg:hidden" onClick={() => setRailOpen(false)} />}
          <div id="browse-filters" ref={railRef} role="dialog" aria-modal={railOpen || undefined} aria-label="Search filters" className={cn("fixed inset-y-0 left-0 z-40 w-[min(88vw,340px)] overflow-y-auto bg-background px-5 pt-16 shadow-overlay transition-transform lg:static lg:z-auto lg:block lg:w-auto lg:translate-x-0 lg:overflow-visible lg:bg-transparent lg:px-0 lg:pt-0 lg:shadow-none", railOpen ? "translate-x-0" : "-translate-x-full")}>
            <div className="mb-2 flex items-center justify-between lg:hidden"><strong className="text-[15px]">Filters</strong><button type="button" className="btn-secondary btn-sm" onClick={() => setRailOpen(false)}>Close</button></div>
            <div className="lg:sticky lg:top-[120px] lg:max-h-[calc(100vh-136px)] lg:overflow-y-auto lg:pr-2 no-scrollbar">
              <FilterRail
                facets={facets.data}
                loading={facets.isFetching && !facets.data}
                level={state.level}
                current={chipsApplied}
                onToggle={onToggle}
                 onMode={onMode}
                onAddCellType={onAddCellType}
                onMinCells={onMinCells}
                onYear={onYear}
                onBundle={onBundle}
                 onFileSamples={(n) => go({ ...explicitBase(), min_file_samples: n })}
                 onFileCells={(n) => go({ ...explicitBase(), min_file_cells: n })}
                 onFileSize={(n) => go({ ...explicitBase(), max_file_bytes: n })}
                 onBoolean={onBoolean}
              />
            </div>
          </div>

          {/* Results */}
          <section aria-label="Results" className="min-w-0">
            {quotaExceeded && nl?.quota && <AiQuotaExceeded quota={nl.quota} message={nl.note ?? "Today's free AI searches are used up."} />}

            <ActiveFiltersRow
              applied={chipsApplied}
              ai={showAiRow}
              dropped={fresh?.dropped}
              note={
                quotaExceeded
                  ? undefined
                  : (fresh?.note ?? (fresh?.any_word ? "No study mentions every word, so these match any of the words instead." : undefined))
              }
              trailing={
                aiMode ? (
                  <>
                    {explainButton}
                    {!quotaExceeded && <AiQuotaBadge />}
                  </>
                ) : undefined
              }
              onRemove={onRemove}
              onAddFilter={focusRail}
              onClear={onClear}
              className="mb-3"
            />
            {explainError && (
              <p role="alert" className="mb-3 text-[12.5px] text-warning">
                {explainError}
              </p>
            )}

            {/* Header */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
              <h1 className="text-[15px] font-sans font-semibold tracking-normal text-foreground tabular" aria-live="polite">
                {loadingInitial ? (
                  <span className="inline-block h-4 w-56 rounded bg-secondary animate-pulse align-middle" />
                ) : totals ? (
                  <>
                    {state.level === "gse" ? (
                      <>
                        {fmtInt(total)} {total === 1 ? "study" : "studies"}
                        {totals.samples != null && <span className="text-muted-foreground font-normal"> · {fmtInt(totals.samples)} samples</span>}
                      </>
                    ) : (
                      <>
                        {fmtInt(total)} {total === 1 ? "sample" : "samples"}
                        {totals.studies != null && <span className="text-muted-foreground font-normal"> · {fmtInt(totals.studies)} studies</span>}
                      </>
                    )}
                    {totals.cells != null && <span className="text-muted-foreground font-normal"> · {fmtCompact(totals.cells)} cells</span>}
                    <span className="text-muted-foreground font-normal"> match</span>
                    {shown.ms != null && <span className="text-muted-foreground font-normal"> · {fmtInt(shown.ms)} ms</span>}
                  </>
                ) : (
                  "Studies"
                )}
              </h1>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Segmented
                  ariaLabel="Result level"
                  value={state.level}
                  onChange={setLevel}
                  options={[
                    { value: "gse", label: "Studies" },
                    { value: "gsm", label: "Samples" },
                  ]}
                />
                {state.level === "gse" && (
                  <Segmented
                    ariaLabel="Layout"
                    value={state.view}
                    onChange={setView}
                    options={[
                      { value: "cards", label: "Cards", icon: <LayoutGrid size={13} /> },
                      { value: "table", label: "Table", icon: <List size={13} /> },
                    ]}
                  />
                )}
                <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <span className="sr-only sm:not-sr-only">Sort</span>
                  <select value={state.sort} onChange={(e) => setSort(e.target.value as Sort)} className="input h-8 w-auto px-2 text-[12.5px]">
                    {SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                {state.level === "gse" && total > 0 && (
                  <ExportMenu query={appliedQuery} total={total} accessionsHref={exportHref} />
                )}
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={!selection.items.length}
                  onClick={() => barRef.current?.focus()}
                >
                  Load selected ({fmtInt(selection.items.length)})
                </button>
              </div>
            </div>

            {/* Body */}
            {result.isError && !shown ? (
              <div className="surface px-5 py-8 text-center">
                <p className="text-[14px] text-foreground">The catalog did not answer.</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{(result.error as Error)?.message}</p>
                <button type="button" onClick={() => result.refetch()} className="btn-secondary btn-sm mt-4">
                  Try again
                </button>
              </div>
            ) : loadingInitial ? (
              <div className="space-y-3" aria-busy="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <StudyCardSkeleton key={i} />
                ))}
              </div>
            ) : shown && shown.total === 0 ? (
              <EmptyState
                level={state.level}
                suggestions={nl?.suggestions ?? []}
                hasFilters={hasActive}
                onApply={applySuggestion}
                onClear={onClear}
                onSamples={state.level === "gse" ? () => setLevel("gsm") : undefined}
              />
            ) : (
              <div className={cn("transition-opacity", refreshing && "opacity-60 pointer-events-none")} aria-busy={refreshing || undefined}>
                {state.level === "gsm" ? (
                  <SampleTable rows={samples} />
                ) : state.view === "table" ? (
                  <StudyTable
                    rows={studies}
                    selectedIds={selection.ids}
                    onToggle={selection.toggle}
                    onTogglePage={(rows, select) => (select ? selection.addMany(rows) : selection.removeMany(rows.map((r) => r.gse_id)))}
                    sort={state.sort}
                    onSort={setSort}
                    ai={showAiRow}
                    why={Object.keys(explanations).length ? { ...(nl?.why ?? {}), ...explanations } : nl?.why}
                    aiWhyIds={explanations}
                  />
                ) : (
                  <>
                    {studies.length > 1 && (
                      <div className="flex items-center gap-2 mb-2 text-[12.5px] text-muted-foreground">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded-[2px]"
                            checked={studies.every((r) => selection.ids.has(r.gse_id))}
                            onChange={(e) => (e.target.checked ? selection.addMany(studies) : selection.removeMany(studies.map((r) => r.gse_id)))}
                          />
                          Select all on this page
                        </label>
                      </div>
                    )}
                    {state.sort === "relevance" && shown?.groups && shown.groups.full > 0 && (
                      <h2 className="mb-2 text-[13px] font-semibold text-foreground">Matches everything ({fmtInt(shown.groups.full)})</h2>
                    )}
                    <div className="space-y-3">
                      {studies.map((r, index) => (
                        <Fragment key={r.gse_id}>
                        {state.sort === "relevance" && shown?.groups && index === shown.groups.full && shown.groups.partial > 0 && (
                          <div className="border-t border-border pt-4 mt-5">
                            <h2 className="text-[13px] font-semibold text-foreground">Partial matches, best first ({fmtInt(shown.groups.partial)})</h2>
                          </div>
                        )}
                        <StudyCard
                          row={r}
                          selected={selection.ids.has(r.gse_id)}
                          onToggle={selection.toggle}
                          ai={showAiRow}
                          why={explanations[r.gse_id] ?? nl?.why?.[r.gse_id]}
                          aiWhy={!!explanations[r.gse_id]}
                        />
                        </Fragment>
                      ))}
                    </div>
                  </>
                )}

                {/* Pagination */}
                {shown && (
                  <nav className="mt-5 flex items-center justify-center gap-4 text-[13px]" aria-label="More results">
                    <span className="text-muted-foreground tabular">Showing 1–{fmtInt(shown.data.length)} of {fmtInt(total)}</span>
                    {canLoadMore && <button type="button" className="btn-secondary btn-sm" onClick={() => setPage(state.page + 1)}>Load 25 more <ChevronRight size={13} /></button>}
                  </nav>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      <SelectionBar ref={barRef} selection={selection} />
      <Footer />
    </div>
  );
};

export default Browse;
