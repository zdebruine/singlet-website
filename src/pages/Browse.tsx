import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, Filter, Database, ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, Download } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useSamples, useFilterOptions, useCorpusStats, useFeaturedSeries, type SampleFilters } from "@/hooks/useDatabase";

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  if (status === "SUCCESS") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"><CheckCircle2 size={12} /> Success</span>;
  if (status === "HARD_FAIL") return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><XCircle size={12} /> Failed</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full"><AlertCircle size={12} /> {status}</span>;
}

const Browse = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse filters from URL
  const filters: SampleFilters = {
    organism: searchParams.get("organism") || undefined,
    protocol: searchParams.get("protocol") || undefined,
    modality: searchParams.get("modality") || undefined,
    status: searchParams.get("status") || undefined,
    qualityTier: (searchParams.get("quality") as "gold" | "silver" | "bronze") || undefined,
    search: searchParams.get("q") || undefined,
    page: Number(searchParams.get("page")) || 0,
    pageSize: Number(searchParams.get("size")) || 50,
    sortBy: searchParams.get("sort") || undefined,
    sortAsc: searchParams.get("asc") === "1" ? true : searchParams.get("asc") === "0" ? false : undefined,
  };

  const setFilters = useCallback((updater: SampleFilters | ((f: SampleFilters) => SampleFilters)) => {
    const next = typeof updater === "function" ? updater(filters) : updater;
    const params = new URLSearchParams();
    if (next.organism) params.set("organism", next.organism);
    if (next.protocol) params.set("protocol", next.protocol);
    if (next.modality) params.set("modality", next.modality);
    if (next.status) params.set("status", next.status);
    if (next.qualityTier) params.set("quality", next.qualityTier);
    if (next.search) params.set("q", next.search);
    if (next.page) params.set("page", String(next.page));
    if (next.pageSize && next.pageSize !== 50) params.set("size", String(next.pageSize));
    if (next.sortBy) params.set("sort", next.sortBy);
    if (next.sortAsc !== undefined) params.set("asc", next.sortAsc ? "1" : "0");
    setSearchParams(params, { replace: true });
  }, [filters, setSearchParams]);

  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts: / or s → focus search, n → next page, p → prev page
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
      if (e.key === "/" || e.key === "s") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "n") setFilters((f) => ({ ...f, page: (f.page ?? 0) + 1 }));
      if (e.key === "p") setFilters((f) => ({ ...f, page: Math.max(0, (f.page ?? 0) - 1) }));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setFilters]);

  const toggleSort = (col: string) => {
    setFilters((f) => ({
      ...f,
      sortBy: col,
      sortAsc: f.sortBy === col ? !f.sortAsc : col === "cells_called" || col === "mapping_rate" || col === "median_genes" ? false : true,
      page: 0,
    }));
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (filters.sortBy !== col) return <ArrowUpDown size={12} className="opacity-30" />;
    return filters.sortAsc ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const { data: corpusStats } = useCorpusStats();
  const { data: filterOptions } = useFilterOptions();
  const { data: featuredSeries } = useFeaturedSeries();
  const { data: result, isLoading, error } = useSamples(filters);

  const samples = result?.samples ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.ceil(total / (filters.pageSize ?? 50));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((f) => ({ ...f, search: searchInput || undefined, page: 0 }));
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-2">
              Browse Datasets
            </h1>
            <p className="text-muted-foreground">
              Explore {formatNumber(corpusStats?.total_samples)} uniformly reprocessed single-cell samples
              across {formatNumber(corpusStats?.species_count)} species and {formatNumber(corpusStats?.series_count)} GEO series.
              {" "}<Link to="/atlas-docs" className="text-primary hover:underline">Load with Python →</Link>
            </p>
          </div>

          {/* Stats bar */}
          {corpusStats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              {[
                { label: "Total Cells", value: formatNumber(corpusStats.total_cells) },
                { label: "Samples", value: formatNumber(corpusStats.total_samples) },
                { label: "Success Rate", value: corpusStats.success_rate ? `${(corpusStats.success_rate * 100).toFixed(1)}%` : "—" },
                { label: "Avg Map Rate", value: corpusStats.avg_mapping_rate ? `${(corpusStats.avg_mapping_rate * 100).toFixed(1)}%` : "—" },
                { label: "Avg Med. Genes", value: formatNumber(corpusStats.avg_median_genes) },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-card p-4 text-center">
                  <div className="text-2xl font-bold text-foreground font-display">{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Quick search chips */}
          <div className="flex gap-2 flex-wrap mb-2">
            <span className="text-xs text-muted-foreground self-center mr-1">Tissue:</span>
            {["brain", "lung", "bone marrow", "liver", "skin", "blood", "tumor", "heart", "kidney"].map((term) => (
              <button
                key={term}
                onClick={() => { setSearchInput(term); setFilters((f) => ({ ...f, search: term, page: 0 })); }}
                className="px-3 py-1 rounded-full text-xs font-medium border border-border bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                {term}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap mb-2">
            <span className="text-xs text-muted-foreground self-center mr-1">Cell type:</span>
            {["PBMC", "T cells", "stem cell", "K562", "organoid", "fibroblasts", "B cells", "NK cells"].map((term) => (
              <button
                key={term}
                onClick={() => { setSearchInput(term); setFilters((f) => ({ ...f, search: term, page: 0 })); }}
                className="px-3 py-1 rounded-full text-xs font-medium border border-border bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                {term}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap mb-4">
            <span className="text-xs text-muted-foreground self-center mr-1">Protocol:</span>
            {["10xv3", "10xv2", "dropseq", "celseq2", "scirna", "marsseq"].map((term) => (
              <button
                key={term}
                onClick={() => setFilters((f) => ({ ...f, protocol: f.protocol === term ? undefined : term, page: 0 }))}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filters.protocol === term ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {term}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap mb-4">
            <span className="text-xs text-muted-foreground self-center mr-1">Quality:</span>
            {([["gold", "🥇"], ["silver", "🥈"], ["bronze", "🥉"]] as const).map(([tier, emoji]) => (
              <button
                key={tier}
                onClick={() => setFilters((f) => ({ ...f, qualityTier: f.qualityTier === tier ? undefined : tier, page: 0 }))}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filters.qualityTier === tier ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {emoji} {tier}
              </button>
            ))}
          </div>

          {/* Featured series */}
          {featuredSeries && featuredSeries.length > 0 && !filters.search && !filters.organism && !filters.qualityTier && (
            <div className="mb-6">
              <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Top Series (by cells)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {featuredSeries.slice(0, 4).map((s) => (
                  <Link
                    key={s.gse_id}
                    to={`/series/${s.gse_id}`}
                    className="rounded-lg border border-border bg-card p-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="font-mono text-xs text-primary font-medium">{s.gse_id}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {s.n_samples} samples • {formatNumber(s.total_cells)} cells • {(s.avg_mapping_rate * 100).toFixed(0)}% MR
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <form onSubmit={handleSearch} className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search by GSM, GSE, title, or tissue... (press / to focus)"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <button type="submit" className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
                Search
              </button>
            </form>

            <div className="flex gap-2 flex-wrap">
              <select
                value={filters.organism ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, organism: e.target.value || undefined, page: 0 }))}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">All Species</option>
                {filterOptions?.organisms.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>

              <select
                value={filters.protocol ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, protocol: e.target.value || undefined, page: 0 }))}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">All Protocols</option>
                {filterOptions?.protocols.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>

              <select
                value={filters.modality ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, modality: e.target.value || undefined, page: 0 }))}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">All Modalities</option>
                {filterOptions?.modalities.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>

              <select
                value={filters.status ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined, page: 0 }))}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">All Statuses</option>
                <option value="SUCCESS">Success</option>
                <option value="SOFT_FAIL">Soft Fail</option>
                <option value="HARD_FAIL">Hard Fail</option>
              </select>

              <select
                value={filters.qualityTier ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, qualityTier: (e.target.value || undefined) as "gold" | "silver" | "bronze" | undefined, page: 0 }))}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">All Quality</option>
                <option value="gold">🥇 Gold</option>
                <option value="silver">🥈 Silver</option>
                <option value="bronze">🥉 Bronze</option>
              </select>

              {(filters.organism || filters.protocol || filters.modality || filters.status || filters.qualityTier || filters.search) && (
                <>
                  <button
                    onClick={() => { setSearchInput(""); setFilters({ page: 0, pageSize: filters.pageSize ?? 50 }); }}
                    className="px-3 py-2 rounded-lg border border-border bg-background text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Clear all ✕
                  </button>
                  <button
                    onClick={() => { navigator.clipboard.writeText(window.location.href); }}
                    className="px-3 py-2 rounded-lg border border-border bg-background text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Copy filtered URL to clipboard"
                  >
                    Share 🔗
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Active filter indicator */}
          {!isLoading && total > 0 && (filters.organism || filters.protocol || filters.modality || filters.status || filters.qualityTier || filters.search) && (
            <div className="text-xs text-muted-foreground mb-2">
              Showing <span className="font-semibold text-foreground">{total.toLocaleString()}</span> matching samples
            </div>
          )}

          {/* Results table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {isLoading ? (
              <div className="p-12 text-center text-muted-foreground">Loading samples...</div>
            ) : error ? (
              <div className="p-12 text-center text-destructive">Error loading data. Ensure Supabase is configured.</div>
            ) : samples.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">No samples found matching your filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("gsm_id")}>
                        <span className="inline-flex items-center gap-1">Sample <SortIcon col="gsm_id" /></span>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("organism")}>
                        <span className="inline-flex items-center gap-1">Organism <SortIcon col="organism" /></span>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("protocol")}>
                        <span className="inline-flex items-center gap-1">Protocol <SortIcon col="protocol" /></span>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("status")}>
                        <span className="inline-flex items-center gap-1">Status <SortIcon col="status" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("cells_called")}>
                        <span className="inline-flex items-center gap-1 justify-end">Cells <SortIcon col="cells_called" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("mapping_rate")}>
                        <span className="inline-flex items-center gap-1 justify-end">Map % <SortIcon col="mapping_rate" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("median_genes")}>
                        <span className="inline-flex items-center gap-1 justify-end">Med. Genes <SortIcon col="median_genes" /></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {samples.map((s) => (
                      <tr key={s.gsm_id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/sample/${s.gsm_id}`} className="font-mono text-primary hover:underline text-xs">
                            {s.gsm_id}
                          </Link>
                          {s.title && <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[240px]">{s.title}</div>}
                          {s.source && <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate max-w-[200px]">{s.source}</div>}
                          {(() => {
                            const chars = (s as Record<string, unknown>).characteristics as Record<string, string> | null;
                            const tissue = chars?.tissue;
                            const cellType = chars?.["cell type"];
                            if (!tissue && !cellType) return null;
                            return (
                              <div className="flex gap-1 mt-0.5 flex-wrap">
                                {tissue && <span className="text-[10px] px-1.5 py-0 rounded bg-primary/10 text-primary/80">{tissue}</span>}
                                {cellType && <span className="text-[10px] px-1.5 py-0 rounded bg-violet-500/10 text-violet-600/80">{cellType}</span>}
                              </div>
                            );
                          })()}
                          {s.gse_id && <Link to={`/series/${s.gse_id}`} className="text-[10px] text-muted-foreground/60 hover:text-primary font-mono">{s.gse_id}</Link>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground italic">{s.organism}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{s.protocol ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={s.status} />
                          {s.failure_category && s.status !== "SUCCESS" && (
                            <div className="text-[10px] text-muted-foreground/60 mt-0.5">{s.failure_category.replace(/_/g, " ")}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {formatNumber(s.cells_called)}
                          {s.status === "SUCCESS" && (() => {
                            const mr = s.mapping_rate ?? 0; const mg = s.median_genes ?? 0; const cells = s.cells_called ?? 0;
                            const isGold = mr >= 0.7 && mg >= 500 && cells >= 500;
                            const isSilver = !isGold && mr >= 0.5 && mg >= 200 && cells >= 100;
                            const color = isGold ? "bg-yellow-400" : isSilver ? "bg-slate-300" : "bg-orange-300";
                            return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} ml-1`} />;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {s.mapping_rate != null ? `${(s.mapping_rate * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{formatNumber(s.median_genes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {total > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    Showing {(filters.page ?? 0) * (filters.pageSize ?? 50) + 1}–{Math.min(((filters.page ?? 0) + 1) * (filters.pageSize ?? 50), total)} of {total.toLocaleString()} samples
                  </span>
                  <button
                    onClick={() => {
                      if (!samples.length) return;
                      const cols = ["gsm_id", "gse_id", "organism", "protocol", "status", "source", "title", "tissue", "cell_type", "mapping_rate", "cells_called", "median_genes", "median_umis", "mt_pct", "doublet_rate"];
                      const header = cols.join(",");
                      const rows = samples.map((s: Record<string, unknown>) => cols.map((c) => {
                        let v = s[c];
                        if (v == null && (c === "tissue" || c === "cell_type")) {
                          const chars = s["characteristics"] as Record<string, string> | null;
                          v = chars?.[c === "cell_type" ? "cell type" : c] ?? "";
                        }
                        if (v == null) return "";
                        const str = String(v);
                        return str.includes(",") ? `"${str}"` : str;
                      }).join(","));
                      const csv = [header, ...rows].join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "singlet_samples.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Export current page to CSV"
                  >
                    <Download size={12} /> CSV
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={filters.pageSize ?? 50}
                    onChange={(e) => setFilters((f) => ({ ...f, pageSize: Number(e.target.value), page: 0 }))}
                    className="px-2 py-1 rounded border border-border bg-background text-xs"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <button
                    onClick={() => setFilters((f) => ({ ...f, page: Math.max(0, (f.page ?? 0) - 1) }))}
                    disabled={(filters.page ?? 0) === 0}
                    className="p-1.5 rounded border border-border hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="px-3 py-1 text-xs text-muted-foreground">
                    Page {(filters.page ?? 0) + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setFilters((f) => ({ ...f, page: Math.min(totalPages - 1, (f.page ?? 0) + 1) }))}
                    disabled={(filters.page ?? 0) >= totalPages - 1}
                    className="p-1.5 rounded border border-border hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Browse;
