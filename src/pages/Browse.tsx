import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Filter, Database, ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useSamples, useFilterOptions, useCorpusStats, type SampleFilters } from "@/hooks/useDatabase";

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
  const [filters, setFilters] = useState<SampleFilters>({ page: 0, pageSize: 50 });
  const [searchInput, setSearchInput] = useState("");

  const { data: corpusStats } = useCorpusStats();
  const { data: filterOptions } = useFilterOptions();
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
            </p>
          </div>

          {/* Stats bar */}
          {corpusStats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              {[
                { label: "Total Cells", value: formatNumber(corpusStats.total_cells) },
                { label: "Samples", value: formatNumber(corpusStats.total_samples) },
                { label: "Success Rate", value: corpusStats.success_rate ? `${(corpusStats.success_rate * 100).toFixed(1)}%` : "—" },
                { label: "Species", value: formatNumber(corpusStats.species_count) },
                { label: "GEO Series", value: formatNumber(corpusStats.series_count) },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-card p-4 text-center">
                  <div className="text-2xl font-bold text-foreground font-display">{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <form onSubmit={handleSearch} className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search by GSM, GSE, or title..."
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
            </div>
          </div>

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
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Sample</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Organism</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Protocol</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cells</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Map %</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Med. Genes</th>
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
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground italic">{s.organism}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{s.protocol ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{formatNumber(s.cells_called)}</td>
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
                <span className="text-xs text-muted-foreground">
                  Showing {(filters.page ?? 0) * (filters.pageSize ?? 50) + 1}–{Math.min(((filters.page ?? 0) + 1) * (filters.pageSize ?? 50), total)} of {total.toLocaleString()} samples
                </span>
                <div className="flex gap-1">
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
