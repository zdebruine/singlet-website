/**
 * Browse / Explorer — v0.9.0
 *
 * Two-column layout:
 *  Left:  Accordion filter sidebar (organism, tissue, cell_type, assay, disease,
 *          QC status, failure_reason [only when Fail/All], sex, year range,
 *          cell-count range slider)
 *  Right: GSE/GSM tab toggle · sortable table · pagination
 *          Live "Showing X studies · Y samples · Z cells" matching bar
 *          Active filters shown as removable chips
 *          Filter state mirrored in URL query params
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search, ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, XCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Download, X, ChevronDown, ChevronRight as ChevronRt, SlidersHorizontal,
  Wand2, Sparkles
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { isSuspectCellCount, FLAGGED_CELLS_LABEL, protocolLabel, isDisplayableOrganism } from "@/lib/catalog-display";
import Footer from "@/components/Footer";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/integrations/api/client";
import type { GsmListParams, GseListParams, GsmRow, GseRow, FacetOption, NlSearchInterpreted } from "@/integrations/api/types";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

// ── Badges ────────────────────────────────────────────────────────────────────

/**
 * Status iconography.
 *  - status === "DONE"  → green check + quality tier (gold/silver/bronze) when present
 *  - status === "FAIL"  → red X (Fail)
 *  - anything else      → amber triangle (e.g. PENDING / RUNNING)
 * D1 columns: status ∈ {DONE, FAIL, ...}; qc_flag ∈ {gold, silver, bronze, null}.
 */
const TIER_STYLE: Record<string, string> = {
  gold: "text-yellow-700 bg-yellow-50",
  silver: "text-slate-600 bg-slate-100",
  bronze: "text-orange-700 bg-orange-50",
};
function StatusBadge({ status, qcFlag }: { status: string; qcFlag?: string | null }) {
  if (status === "DONE") {
    const tier = (qcFlag || "").toLowerCase();
    if (tier && TIER_STYLE[tier]) {
      return <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${TIER_STYLE[tier]}`}><CheckCircle size={11} /> {tier.charAt(0).toUpperCase() + tier.slice(1)}</span>;
    }
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"><CheckCircle size={11} /> Done</span>;
  }
  if (status === "FAIL") {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><XCircle size={11} /> Fail</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full"><AlertTriangle size={11} /> {status}</span>;
}

// ── Accordion Section ─────────────────────────────────────────────────────────

function AccordionSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-foreground uppercase tracking-wider hover:bg-muted/30 transition-colors"
      >
        {label}
        {open ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRt size={13} className="text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// ── Facet Checkbox List ───────────────────────────────────────────────────────

function FacetList({
  options,
  value,
  onChange,
  max = 8,
  labelFn,
}: {
  options: FacetOption[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  max?: number;
  /** Display-only relabelling; the stored facet value is unchanged. */
  labelFn?: (v: string) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? options : options.slice(0, max);
  const groupName = `facet-${options[0]?.value ?? "empty"}`;
  return (
    <div className="space-y-1.5">
      {visible.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 cursor-pointer group">
          <input
            type="radio"
            name={groupName}
            checked={value === opt.value}
            onChange={() => onChange(value === opt.value ? undefined : opt.value)}
            onClick={() => { if (value === opt.value) onChange(undefined); }}
            className="accent-primary"
          />
          <span className={`text-xs truncate flex-1 group-hover:text-foreground transition-colors ${value === opt.value ? "text-foreground font-medium" : "text-muted-foreground"}`}>{labelFn ? labelFn(opt.value) : opt.value}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground/60 flex-shrink-0">{opt.count.toLocaleString()}</span>
        </label>
      ))}
      {options.length > max && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[10px] text-primary hover:underline mt-1"
        >
          {showAll ? "Show less" : `+${options.length - max} more`}
        </button>
      )}
    </div>
  );
}

// ── Range Slider (cells) ─────────────────────────────────────────────────────

function CellRangeSlider({
  value,
  onChange,
}: {
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [local, setLocal] = useState(value);
  const STEPS = [0, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{fmt(local[0])}</span>
        <span>{local[1] >= 1000000 ? "1M+" : fmt(local[1])}</span>
      </div>
      <input
        type="range"
        min={0}
        max={STEPS.length - 1}
        value={STEPS.indexOf(STEPS.reduce((prev, cur) => Math.abs(cur - local[0]) < Math.abs(prev - local[0]) ? cur : prev))}
        onChange={(e) => {
          const newMin = STEPS[Number(e.target.value)];
          const newVal: [number, number] = [newMin, Math.max(newMin, local[1])];
          setLocal(newVal);
          onChange(newVal);
        }}
        className="w-full accent-primary"
      />
      <input
        type="range"
        min={0}
        max={STEPS.length - 1}
        value={STEPS.indexOf(STEPS.reduce((prev, cur) => Math.abs(cur - local[1]) < Math.abs(prev - local[1]) ? cur : prev))}
        onChange={(e) => {
          const newMax = STEPS[Number(e.target.value)];
          const newVal: [number, number] = [Math.min(local[0], newMax), newMax];
          setLocal(newVal);
          onChange(newVal);
        }}
        className="w-full accent-primary"
      />
    </div>
  );
}

// ── Filter Chip ───────────────────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
      {label}
      <button onClick={onRemove} className="ml-0.5 hover:text-primary/70">
        <X size={10} />
      </button>
    </span>
  );
}

// ── Sort icon helper ──────────────────────────────────────────────────────────

function SortIcon({ col, sortBy, sortAsc }: { col: string; sortBy: string | undefined; sortAsc: boolean }) {
  if (sortBy !== col) return <ArrowUpDown size={11} className="opacity-30" />;
  return sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
}

// ── Main component ────────────────────────────────────────────────────────────

const Browse = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Parse URL → filter state ──────────────────────────────────────────────
  const tab = (searchParams.get("tab") ?? "gsm") as "gsm" | "gse";
  const organism = searchParams.get("organism") || undefined;
  const tissue = searchParams.get("tissue") || undefined;
  const cellType = searchParams.get("cell_type") || undefined;
  const protocol = searchParams.get("protocol") || undefined;
  const disease = searchParams.get("disease") || undefined;
  const sex = searchParams.get("sex") || undefined;
  const qcStatus = searchParams.get("status") || undefined;          // Pass / Warn / Fail / All
  const failureCategory = searchParams.get("failure_category") || undefined;
  const q = searchParams.get("q") || undefined;
  const nl = searchParams.get("nl") || undefined;
  const page = Number(searchParams.get("page")) || 0;
  const pageSize = Number(searchParams.get("size")) || 50;
  const sortBy = searchParams.get("sort") || undefined;
  const sortAsc = searchParams.get("asc") === "1";
  const minCells = Number(searchParams.get("min_cells")) || 0;
  const maxCells = Number(searchParams.get("max_cells")) || 1000000;

  const [searchInput, setSearchInput] = useState(q ?? "");
  const [nlInput, setNlInput] = useState(nl ?? "");

  // ── Sync searchInput when URL changes ─────────────────────────────────────
  useEffect(() => { setSearchInput(q ?? ""); }, [q]);
  useEffect(() => { setNlInput(nl ?? ""); }, [nl]);

  // ── Push filters → URL ────────────────────────────────────────────────────
  // Using a normal facet/keyword filter clears any active NL query so the two
  // entry points don't fight; the NL submit handler manages `nl` itself.
  const setParam = useCallback((key: string, val: string | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set(key, val); else next.delete(key);
      next.delete("nl"); // facet/keyword use clears the NL query
      next.delete("page"); // reset page on filter change
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ── Submit an NL query → URL (?nl=...) ────────────────────────────────────
  const submitNl = useCallback((text: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const t = text.trim();
      if (t) next.set("nl", t); else next.delete("nl");
      next.set("tab", "gsm"); // NL results render in the samples view
      next.delete("page");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const resetPage = useCallback(() => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete("page"); return n; }, { replace: true });
  }, [setSearchParams]);

  const setPage = useCallback((p: number) => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); if (p > 0) n.set("page", String(p)); else n.delete("page"); return n; }, { replace: true });
  }, [setSearchParams]);

  const toggleSort = useCallback((col: string) => {
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev);
      const prevSort = n.get("sort");
      const prevAsc = n.get("asc") === "1";
      if (prevSort === col) {
        n.set("asc", prevAsc ? "0" : "1");
      } else {
        n.set("sort", col);
        n.set("asc", col === "gsm_id" || col === "id" ? "1" : "0");
      }
      n.delete("page");
      return n;
    }, { replace: true });
  }, [setSearchParams]);

  const clearAll = useCallback(() => {
    setSearchInput("");
    setSearchParams(new URLSearchParams({ tab }), { replace: true });
  }, [setSearchParams, tab]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT") return;
      if (e.key === "/" || e.key === "s") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Facets data ───────────────────────────────────────────────────────────
  const { data: facets } = useQuery({
    queryKey: ["facets"],
    queryFn: () => apiClient.facets(),
    staleTime: 300_000,
  });

  // ── Corpus stats ──────────────────────────────────────────────────────────
  const { data: corpusStats } = useQuery({
    queryKey: ["corpus-stats"],
    queryFn: () => apiClient.stats(),
    staleTime: 60_000,
  });

  // ── Derive API status / qc_flag params ────────────────────────────────────
  // UI radios: All / Gold / Silver / Bronze / Failed.
  // D1: status ∈ {DONE, FAIL, ...}; qc_flag (quality tier) ∈ {gold, silver, bronze, null}.
  //   Gold/Silver/Bronze → qc_flag=<tier> · Failed → status=FAIL.
  const { apiStatus, apiQcFlag } = useMemo(() => {
    if (!qcStatus || qcStatus === "All") return { apiStatus: undefined, apiQcFlag: undefined };
    if (qcStatus === "Failed") return { apiStatus: "FAIL", apiQcFlag: undefined };
    if (["Gold", "Silver", "Bronze"].includes(qcStatus)) {
      return { apiStatus: undefined, apiQcFlag: qcStatus.toLowerCase() };
    }
    return { apiStatus: qcStatus, apiQcFlag: undefined };
  }, [qcStatus]);

  const showFailureCategory = qcStatus === "Failed" || qcStatus === "All" || !qcStatus;

  // ── GSM query ─────────────────────────────────────────────────────────────
  const gsmParams: GsmListParams = {
    organism, protocol, tissue, cell_type: cellType, disease, sex,
    status: apiStatus,
    qc_flag: apiQcFlag,
    failure_category: failureCategory,
    q,
    page, page_size: pageSize,
    sort: sortBy,
    asc: sortBy ? sortAsc : undefined,
    min_cells: minCells > 0 ? minCells : undefined,
    max_cells: maxCells < 1000000 ? maxCells : undefined,
  };
  const { data: gsmResult, isLoading: gsmLoading } = useQuery({
    queryKey: ["gsm-list", gsmParams],
    queryFn: () => apiClient.gsmList(gsmParams),
    staleTime: 30_000,
    enabled: tab === "gsm" && !nl,
  });

  // ── GSE query ─────────────────────────────────────────────────────────────
  const gseParams: GseListParams = {
    organism, q,
    page, page_size: pageSize,
    sort: sortBy,
    asc: sortBy ? sortAsc : undefined,
    min_cells: minCells > 0 ? minCells : undefined,
    max_cells: maxCells < 1000000 ? maxCells : undefined,
  };
  const { data: gseResult, isLoading: gseLoading } = useQuery({
    queryKey: ["gse-list", gseParams],
    queryFn: () => apiClient.gseList(gseParams),
    staleTime: 30_000,
    enabled: tab === "gse",
  });

  // ── NL (AI) search query ──────────────────────────────────────────────────
  // Active only when ?nl=... is present. Results render in the GSM (samples)
  // view, replacing the faceted list. Server-side translates the query to
  // structured filters via Claude Haiku (or degrades to keyword search).
  const { data: nlResult, isLoading: nlLoading, isError: nlError } = useQuery({
    queryKey: ["nl-search", nl, pageSize],
    queryFn: () => apiClient.nlSearch(nl!, { level: "gsm", limit: pageSize }),
    staleTime: 60_000,
    enabled: !!nl && tab === "gsm",
  });
  const nlActive = !!nl && tab === "gsm";

  const isLoading = nlActive ? nlLoading : tab === "gsm" ? gsmLoading : gseLoading;
  const totalItems = nlActive
    ? (nlResult?.total ?? 0)
    : tab === "gsm" ? (gsmResult?.total ?? 0) : (gseResult?.total ?? 0);
  // NL search returns a single capped page (server has no offset paging), so
  // pagination collapses to one page in that mode.
  const totalPages = nlActive ? 1 : Math.ceil(totalItems / pageSize);
  const gsmRows = (nlActive ? (nlResult?.data as GsmRow[] | undefined) : gsmResult?.data) ?? [];
  const gseRows = gseResult?.data ?? [];

  // ── Total cells in current GSM result (summed) ────────────────────────────
  const resultCells = useMemo(
    () => gsmRows.reduce((a, s) => a + (isSuspectCellCount(s.protocol, s.n_cells) ? 0 : (s.n_cells ?? 0)), 0),
    [gsmRows]
  );
  const organismFacets = useMemo(
    () => (facets?.organisms ?? []).filter((o) => isDisplayableOrganism(o.value)),
    [facets]
  );

  // ── Active filter count ───────────────────────────────────────────────────
  const activeFilters = [organism, tissue, cellType, protocol, disease, sex, qcStatus, failureCategory, q, minCells > 0 ? "min_cells" : null, maxCells < 1000000 ? "max_cells" : null].filter(Boolean);

  // ── CSV export ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (!gsmRows.length) return;
    const cols = ["gsm_id", "gse_id", "organism", "protocol", "tissue", "cell_type", "disease", "sex", "status", "n_cells", "mapping_rate", "median_genes", "failure_category"];
    const rows = gsmRows.map((s: GsmRow) => cols.map((c) => {
      const v = (s as unknown as Record<string, unknown>)[c];
      if (v == null) return "";
      const str = String(v);
      return str.includes(",") ? `"${str}"` : str;
    }).join(","));
    const blob = new Blob([[cols.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "singlet_samples.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <section className="pt-24 pb-20 px-4 md:px-6">
        <div className="max-w-8xl mx-auto">

          {/* ── PAGE HEADER ── */}
          <div className="mb-5">
            <h1 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-1">
              Singlet Atlas Explorer
            </h1>
            <p className="text-sm text-muted-foreground">
              {fmt(corpusStats?.total_cells)} cells across {fmt(corpusStats?.total_samples)} samples and {fmt(corpusStats?.series_count)} GEO series.
              {" "}<Link to="/docs/access" className="text-primary hover:underline text-xs">Load with Python →</Link>
            </p>
          </div>

          {/* ── AI / NATURAL-LANGUAGE SEARCH ── */}
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/[0.04] p-3">
            <div className="flex gap-2 items-stretch">
              <div className="relative flex-1">
                <Sparkles size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                <input
                  type="text"
                  placeholder={'"T cells from pediatric AML" — ask in plain English'}
                  value={nlInput}
                  onChange={(e) => setNlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNl(nlInput); }}
                  className="w-full pl-9 pr-4 py-2 rounded-lg border border-primary/30 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                onClick={() => submitNl(nlInput)}
                disabled={!nlInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                <Wand2 size={14} /> AI Search
              </button>
              {nl && (
                <button
                  onClick={() => { setNlInput(""); setParam("nl", undefined); }}
                  className="inline-flex items-center px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Clear AI search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* "Interpreted as" chips — only when AI is configured and returned filters */}
            {nlActive && nlResult?.configured && nlResult.interpreted && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                <span className="text-[11px] text-muted-foreground">Interpreted as:</span>
                {(() => {
                  const i = nlResult.interpreted as NlSearchInterpreted;
                  const chips: { label: string; val: string }[] = [];
                  i.organism.forEach((v) => chips.push({ label: "Organism", val: v }));
                  i.tissue.forEach((v) => chips.push({ label: "Tissue", val: v }));
                  i.cell_type.forEach((v) => chips.push({ label: "Cell type", val: v }));
                  i.disease.forEach((v) => chips.push({ label: "Disease", val: v }));
                  i.protocol.forEach((v) => chips.push({ label: "Protocol", val: protocolLabel(v) }));
                  i.sex.forEach((v) => chips.push({ label: "Sex", val: v }));
                  if (i.min_cells != null) chips.push({ label: "Min cells", val: fmt(i.min_cells) });
                  if (i.q) chips.push({ label: "Keywords", val: i.q });
                  if (chips.length === 0) {
                    return <span className="text-[11px] text-muted-foreground italic">no specific filters — showing all matches</span>;
                  }
                  return chips.map((c, idx) => (
                    <span key={`${c.label}-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
                      <span className="text-primary/60">{c.label}:</span> {c.val}
                    </span>
                  ));
                })()}
              </div>
            )}

            {/* Not-configured note — subtle, not broken-looking */}
            {nlActive && nlResult && nlResult.configured === false && (
              <p className="text-[11px] text-muted-foreground mt-2.5">
                AI search not configured yet — showing keyword matches.
              </p>
            )}
            {nlActive && nlError && (
              <p className="text-[11px] text-amber-600 mt-2.5">
                AI search is temporarily unavailable. Try the keyword search below.
              </p>
            )}
          </div>

          {/* ── SEARCH BAR ── */}
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search GSM, GSE, tissue, cell type... (press / to focus)"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setParam("q", searchInput || undefined); } }}
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              onClick={() => { setParam("q", searchInput || undefined); }}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              Search
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Toggle filters"
            >
              <SlidersHorizontal size={14} />
              <span className="hidden sm:inline">Filters</span>
              {activeFilters.length > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                  {activeFilters.length}
                </span>
              )}
            </button>
          </div>

          {/* ── ACTIVE FILTER CHIPS ── */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4 items-center">
              <span className="text-xs text-muted-foreground">Active:</span>
              {organism && <FilterChip label={`Organism: ${organism}`} onRemove={() => setParam("organism", undefined)} />}
              {tissue && <FilterChip label={`Tissue: ${tissue}`} onRemove={() => setParam("tissue", undefined)} />}
              {cellType && <FilterChip label={`Cell type: ${cellType}`} onRemove={() => setParam("cell_type", undefined)} />}
              {protocol && <FilterChip label={`Protocol: ${protocolLabel(protocol)}`} onRemove={() => setParam("protocol", undefined)} />}
              {disease && <FilterChip label={`Disease: ${disease}`} onRemove={() => setParam("disease", undefined)} />}
              {sex && <FilterChip label={`Sex: ${sex}`} onRemove={() => setParam("sex", undefined)} />}
              {qcStatus && <FilterChip label={`Status: ${qcStatus}`} onRemove={() => setParam("status", undefined)} />}
              {failureCategory && <FilterChip label={`Failure: ${failureCategory}`} onRemove={() => setParam("failure_category", undefined)} />}
              {q && <FilterChip label={`"${q}"`} onRemove={() => { setSearchInput(""); setParam("q", undefined); }} />}
              {minCells > 0 && <FilterChip label={`Min cells: ${fmt(minCells)}`} onRemove={() => setParam("min_cells", undefined)} />}
              {maxCells < 1000000 && <FilterChip label={`Max cells: ${fmt(maxCells)}`} onRemove={() => setParam("max_cells", undefined)} />}
              <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground underline ml-1">Clear all</button>
              <button
                onClick={() => navigator.clipboard.writeText(window.location.href)}
                className="text-xs text-muted-foreground hover:text-foreground underline ml-1"
              >
                Copy URL
              </button>
            </div>
          )}

          {/* ── TWO COLUMN LAYOUT ── */}
          <div className="flex gap-5 items-start">

            {/* ── LEFT SIDEBAR ── */}
            {sidebarOpen && (
              <div className="w-56 flex-shrink-0 rounded-xl border border-border bg-card sticky top-20 overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">Filters</span>
                  {activeFilters.length > 0 && (
                    <button onClick={clearAll} className="text-[10px] text-primary hover:underline">Reset</button>
                  )}
                </div>

                {/* Organism */}
                {organismFacets.length > 0 && (
                  <AccordionSection label="Organism" defaultOpen>
                    <FacetList
                      options={organismFacets}
                      value={organism}
                      onChange={(v) => setParam("organism", v)}
                    />
                  </AccordionSection>
                )}

                {/* Tissue */}
                {(facets?.tissues ?? []).length > 0 && (
                  <AccordionSection label="Tissue" defaultOpen>
                    <FacetList
                      options={facets?.tissues ?? []}
                      value={tissue}
                      onChange={(v) => setParam("tissue", v)}
                      max={6}
                    />
                  </AccordionSection>
                )}

                {/* Cell Type */}
                {(facets?.cell_types ?? []).length > 0 && (
                  <AccordionSection label="Cell Type">
                    <FacetList
                      options={facets?.cell_types ?? []}
                      value={cellType}
                      onChange={(v) => setParam("cell_type", v)}
                      max={6}
                    />
                  </AccordionSection>
                )}

                {/* Assay / Protocol */}
                {(facets?.protocols ?? []).length > 0 && (
                  <AccordionSection label="Assay / Protocol">
                    <FacetList
                      options={facets?.protocols ?? []}
                      value={protocol}
                      onChange={(v) => setParam("protocol", v)}
                      labelFn={protocolLabel}
                    />
                  </AccordionSection>
                )}

                {/* Disease */}
                {(facets?.diseases ?? []).length > 0 && (
                  <AccordionSection label="Disease">
                    <FacetList
                      options={facets?.diseases ?? []}
                      value={disease}
                      onChange={(v) => setParam("disease", v)}
                      max={6}
                    />
                  </AccordionSection>
                )}

                {/* QC quality tier */}
                <AccordionSection label="Quality" defaultOpen>
                  <div className="space-y-1.5">
                    {(["All", "Gold", "Silver", "Bronze", "Failed"] as const).map((s) => (
                      <label key={s} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="radio"
                          checked={(!qcStatus && s === "All") || qcStatus === s}
                          onChange={() => setParam("status", s === "All" ? undefined : s)}
                          className="accent-primary"
                        />
                        <span className={`text-xs ${(!qcStatus && s === "All") || qcStatus === s ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s}</span>
                      </label>
                    ))}
                  </div>
                </AccordionSection>

                {/* Failure Reason — only when Fail / All */}
                {showFailureCategory && (facets?.failure_categories ?? []).length > 0 && (
                  <AccordionSection label="Failure Reason">
                    <FacetList
                      options={facets?.failure_categories ?? []}
                      value={failureCategory}
                      onChange={(v) => setParam("failure_category", v)}
                    />
                  </AccordionSection>
                )}

                {/* Sex */}
                {(facets?.sexes ?? []).length > 0 && (
                  <AccordionSection label="Sex">
                    <FacetList
                      options={facets?.sexes ?? []}
                      value={sex}
                      onChange={(v) => setParam("sex", v)}
                    />
                  </AccordionSection>
                )}

                {/* Cell count range */}
                <AccordionSection label="Cell Count Range">
                  <CellRangeSlider
                    value={[minCells, maxCells]}
                    onChange={([mn, mx]) => {
                      setSearchParams((prev) => {
                        const n = new URLSearchParams(prev);
                        if (mn > 0) n.set("min_cells", String(mn)); else n.delete("min_cells");
                        if (mx < 1000000) n.set("max_cells", String(mx)); else n.delete("max_cells");
                        n.delete("page");
                        return n;
                      }, { replace: true });
                    }}
                  />
                </AccordionSection>
              </div>
            )}

            {/* ── RIGHT RESULTS AREA ── */}
            <div className="flex-1 min-w-0">

              {/* GSE/GSM Tab toggle */}
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(["gsm", "gse"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("tab", t); n.delete("page"); return n; }, { replace: true });
                      }}
                      className={`px-4 py-1.5 text-xs font-medium transition-colors ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground bg-background hover:bg-muted"}`}
                    >
                      {t === "gsm" ? "Samples (GSM)" : "Studies (GSE)"}
                    </button>
                  ))}
                </div>

                {/* Live matching bar */}
                <div className="text-xs text-muted-foreground">
                  {!isLoading && tab === "gsm" && (nlActive ? nlResult : gsmResult) && (
                    <span>
                      <span className="font-semibold text-foreground">{totalItems.toLocaleString()}</span> samples ·{" "}
                      <span className="font-semibold text-foreground">{fmt(resultCells)}</span> cells on this page
                    </span>
                  )}
                  {!isLoading && tab === "gse" && gseResult && (
                    <span>
                      <span className="font-semibold text-foreground">{gseResult.total.toLocaleString()}</span> studies
                    </span>
                  )}
                  {isLoading && <span className="animate-pulse">Loading...</span>}
                </div>
              </div>

              {/* Results table */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {isLoading ? (
                  <div className="p-12 text-center text-muted-foreground text-sm">Loading...</div>
                ) : tab === "gsm" && gsmRows.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm">No samples match your filters.</div>
                ) : tab === "gse" && gseRows.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm">No studies match your filters.</div>
                ) : tab === "gsm" ? (
                  /* ── GSM TABLE (md+) ── */
                  <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {([
                            ["gsm_id", "Sample", "text-left px-4"],
                            ["organism", "Organism", "text-left px-3"],
                            ["protocol", "Protocol", "text-left px-3"],
                            ["status", "Status", "text-left px-3"],
                            ["n_cells", "Cells", "text-right px-3"],
                            ["mapping_rate", "Map %", "text-right px-3"],
                            ["median_genes", "Med. Genes", "text-right px-4"],
                          ] as [string, string, string][]).map(([col, label, cls]) => (
                            <th
                              key={col}
                              onClick={() => toggleSort(col)}
                              className={`${cls} py-3 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {label} <SortIcon col={col} sortBy={sortBy} sortAsc={sortAsc} />
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {gsmRows.map((s: GsmRow) => {
                          const isFailed = s.status === "FAIL";
                          return (
                            <tr key={s.gsm_id} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${isFailed ? "bg-red-50/20" : ""}`}>
                              <td className="px-4 py-2.5">
                                <Link to={`/sample/${s.gsm_id}`} className="font-mono text-xs text-primary hover:underline">{s.gsm_id}</Link>
                                {s.title && <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[200px]">{s.title}</div>}
                                {s.gse_id && <Link to={`/series/${s.gse_id}`} className="text-[10px] text-muted-foreground/60 hover:text-primary font-mono">{s.gse_id}</Link>}
                              </td>
                              <td className="px-3 py-2.5 text-xs italic text-muted-foreground">{s.organism}</td>
                              <td className="px-3 py-2.5">
                                <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">{protocolLabel(s.protocol)}</span>
                              </td>
                              <td className="px-3 py-2.5">
                                <StatusBadge status={s.status} qcFlag={s.qc_flag} />
                                {isFailed && s.failure_category && (
                                  <div className="text-[10px] text-red-600/70 mt-0.5">{s.failure_category.replace(/_/g, " ")}</div>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-xs">
                                {isSuspectCellCount(s.protocol, s.n_cells)
                                  ? <span className="text-[10px] italic text-amber-600 font-sans" title="Known plate-protocol cell-count bug — value withheld pending pipeline fix">{FLAGGED_CELLS_LABEL}</span>
                                  : fmt(s.n_cells)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-xs">{s.mapping_rate != null ? `${(s.mapping_rate * 100).toFixed(1)}%` : "—"}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs">{fmt(s.median_genes)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ── GSM CARDS (mobile, <md) ── */}
                  <div className="md:hidden divide-y divide-border/40">
                    {gsmRows.map((s: GsmRow) => {
                      const isFailed = s.status === "FAIL";
                      return (
                        <div key={s.gsm_id} className={`p-4 ${isFailed ? "bg-red-50/20" : ""}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <Link to={`/sample/${s.gsm_id}`} className="font-mono text-sm text-primary hover:underline">{s.gsm_id}</Link>
                              {s.gse_id && <Link to={`/series/${s.gse_id}`} className="block text-[10px] text-muted-foreground/60 hover:text-primary font-mono">{s.gse_id}</Link>}
                            </div>
                            <StatusBadge status={s.status} qcFlag={s.qc_flag} />
                          </div>
                          {s.title && <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{s.title}</div>}
                          {isFailed && s.failure_category && (
                            <div className="text-[10px] text-red-600/70 mt-0.5">{s.failure_category.replace(/_/g, " ")}</div>
                          )}
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[11px]">
                            <div><span className="text-muted-foreground">Organism: </span><span className="italic">{s.organism ?? "—"}</span></div>
                            <div><span className="text-muted-foreground">Protocol: </span><span className="font-mono">{protocolLabel(s.protocol)}</span></div>
                            <div><span className="text-muted-foreground">Cells: </span>{isSuspectCellCount(s.protocol, s.n_cells) ? <span className="italic text-amber-600">{FLAGGED_CELLS_LABEL}</span> : <span className="font-mono">{fmt(s.n_cells)}</span>}</div>
                            <div><span className="text-muted-foreground">Map %: </span><span className="font-mono">{s.mapping_rate != null ? `${(s.mapping_rate * 100).toFixed(1)}%` : "—"}</span></div>
                            <div><span className="text-muted-foreground">Med. genes: </span><span className="font-mono">{fmt(s.median_genes)}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </>
                ) : (
                  /* ── GSE TABLE ── */
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {([
                            ["id", "Series", "text-left px-4"],
                            ["organism", "Organism", "text-left px-3"],
                            ["n_gsm_total", "Samples", "text-right px-3"],
                            ["n_cells", "Cells", "text-right px-3"],
                            ["submitted_date", "Year", "text-right px-4"],
                          ] as [string, string, string][]).map(([col, label, cls]) => (
                            <th
                              key={col}
                              onClick={() => toggleSort(col)}
                              className={`${cls} py-3 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {label} <SortIcon col={col} sortBy={sortBy} sortAsc={sortAsc} />
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {gseRows.map((s: GseRow) => (
                          <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5">
                              <Link to={`/series/${s.id}`} className="font-mono text-xs text-primary hover:underline">{s.id}</Link>
                              {s.title && <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[280px]">{s.title}</div>}
                            </td>
                            <td className="px-3 py-2.5 text-xs italic text-muted-foreground">{s.organism}</td>
                            <td className="px-3 py-2.5 text-right text-xs">
                              <span className="text-emerald-600 font-mono">{s.n_gsm_done}</span>
                              <span className="text-muted-foreground font-mono">/{s.n_gsm_total}</span>
                              {s.n_gsm_failed > 0 && (
                                <span className="text-red-500 font-mono ml-1">({s.n_gsm_failed} fail)</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-xs">{fmt(s.n_cells)}</td>
                            <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                              {s.submitted_date ? new Date(s.submitted_date).getFullYear() : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {totalItems > 0 && !isLoading && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-border bg-muted/10">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {nlActive
                          ? <>Showing {gsmRows.length.toLocaleString()} of {totalItems.toLocaleString()} matching samples</>
                          : <>Showing {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, totalItems).toLocaleString()} of {totalItems.toLocaleString()} {tab === "gsm" ? "samples" : "studies"}</>}
                      </span>
                      {tab === "gsm" && (
                        <button
                          onClick={exportCSV}
                          className="flex items-center gap-1 px-2 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Export page to CSV"
                        >
                          <Download size={11} /> CSV
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="hidden sm:inline">Rows</span>
                        <select
                          value={pageSize}
                          onChange={(e) => setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("size", e.target.value); n.delete("page"); return n; }, { replace: true })}
                          className="px-2 py-1 rounded border border-border bg-background text-xs"
                        >
                          {[25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="p-1.5 rounded border border-border hover:bg-muted disabled:opacity-30" title="Previous page">
                        <ChevronLeft size={13} />
                      </button>
                      <span className="text-xs text-muted-foreground px-2 whitespace-nowrap">
                        Page {page + 1} of {totalPages.toLocaleString()}
                      </span>
                      <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="p-1.5 rounded border border-border hover:bg-muted disabled:opacity-30" title="Next page">
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Browse;
