import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DownloadPanel } from "@/components/DownloadPanel";
import { apiClient } from "@/integrations/api/client";
import type { GseDetailResponse, GsmRow, PublicationRow } from "@/integrations/api/types";

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatYear(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).getFullYear().toString();
}

function StatusBadge({ status, failureCategory }: { status: string; failureCategory?: string | null }) {
  if (status === "SUCCESS") {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"><CheckCircle2 size={12} /> Pass</span>;
  }
  if (status === "HARD_FAIL") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
        <XCircle size={12} /> Fail
        {failureCategory && <span className="ml-1 opacity-70">({failureCategory.replace(/_/g, " ")})</span>}
      </span>
    );
  }
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full"><AlertCircle size={12} /> {status}</span>;
}

function QCSummaryBar({ samples }: { samples: GsmRow[] }) {
  const success = samples.filter(s => s.status === "SUCCESS");
  if (success.length === 0) return null;

  const gold = success.filter(s => (s.mapping_rate ?? 0) >= 0.7 && (s.median_genes ?? 0) >= 500 && (s.n_cells ?? 0) >= 500).length;
  const silver = success.filter(s => {
    const mr = s.mapping_rate ?? 0; const mg = s.median_genes ?? 0; const cells = s.n_cells ?? 0;
    return !(mr >= 0.7 && mg >= 500 && cells >= 500) && (mr >= 0.5 && mg >= 200 && cells >= 100);
  }).length;
  const bronze = success.length - gold - silver;

  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden border border-border/50">
        {gold > 0 && <div className="bg-yellow-400" style={{ width: `${(gold / success.length) * 100}%` }} title={`Gold: ${gold}`} />}
        {silver > 0 && <div className="bg-slate-300" style={{ width: `${(silver / success.length) * 100}%` }} title={`Silver: ${silver}`} />}
        {bronze > 0 && <div className="bg-orange-300" style={{ width: `${(bronze / success.length) * 100}%` }} title={`Bronze: ${bronze}`} />}
      </div>
      <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
        {gold > 0 && <span><span className="inline-block w-2 h-2 rounded-sm bg-yellow-400 mr-1" />{gold} gold</span>}
        {silver > 0 && <span><span className="inline-block w-2 h-2 rounded-sm bg-slate-300 mr-1" />{silver} silver</span>}
        {bronze > 0 && <span><span className="inline-block w-2 h-2 rounded-sm bg-orange-300 mr-1" />{bronze} bronze</span>}
      </div>
    </div>
  );
}

function PublicationCard({ pub }: { pub: PublicationRow }) {
  const [abstractOpen, setAbstractOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-medium text-foreground leading-snug">{pub.title ?? "Untitled"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {pub.journal ?? "Unknown journal"}
            {pub.year ? ` · ${pub.year}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pub.doi && (
            <a
              href={`https://doi.org/${pub.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              DOI <ExternalLink size={10} />
            </a>
          )}
          <a
            href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            PubMed <ExternalLink size={10} />
          </a>
        </div>
      </div>
      {pub.abstract && (
        <div>
          <button
            onClick={() => setAbstractOpen(!abstractOpen)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            {abstractOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {abstractOpen ? "Hide abstract" : "Show abstract"}
          </button>
          {abstractOpen && (
            <p className="text-xs text-muted-foreground leading-relaxed mt-2 border-l-2 border-border pl-3">
              {pub.abstract}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function useSeriesDetail(gseId: string) {
  return useQuery({
    queryKey: ["series-detail", gseId],
    queryFn: () => apiClient.gse(gseId),
    enabled: !!gseId,
    staleTime: 60_000,
  });
}

type SortCol = "gsm_id" | "status" | "n_cells" | "mapping_rate" | "median_genes" | "protocol";

const SeriesDetail = () => {
  const { gseId } = useParams<{ gseId: string }>();
  const { data, isLoading, error } = useSeriesDetail(gseId ?? "");
  const [sortCol, setSortCol] = useState<SortCol>("gsm_id");
  const [sortAsc, setSortAsc] = useState(true);
  const [abstractOpen, setAbstractOpen] = useState(false);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(col === "gsm_id" || col === "status"); }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown size={11} className="opacity-30" />;
    return sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  };

  if (isLoading) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-32 pb-20 px-6 text-center text-muted-foreground">Loading series...</div>
      <Footer />
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-32 pb-20 px-6 text-center">
        <h1 className="text-2xl font-bold text-foreground mb-2">Series Not Found</h1>
        <p className="text-muted-foreground mb-4">{gseId} was not found in the catalog.</p>
        <Link to="/browse" className="text-primary hover:underline">← Browse all samples</Link>
      </div>
      <Footer />
    </div>
  );

  const { series, samples, publications } = data as GseDetailResponse;

  const failedSamples = samples.filter(s => s.status !== "SUCCESS");
  const successSamples = samples.filter(s => s.status === "SUCCESS");
  const totalCells = successSamples.reduce((a, s) => a + (s.n_cells ?? 0), 0);
  const avgMR = successSamples.length
    ? successSamples.reduce((a, s) => a + (s.mapping_rate ?? 0), 0) / successSamples.length
    : null;

  // Aggregate failure reasons for QC note
  const failureReasons = failedSamples.reduce((acc, s) => {
    if (s.failure_category) {
      acc[s.failure_category] = (acc[s.failure_category] ?? 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
  const topReasons = Object.entries(failureReasons).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const organisms = [...new Set(samples.map(s => s.organism).filter(Boolean))];
  const tissues = [...new Set(samples.map(s => s.tissue).filter(Boolean))];
  const diseases = [...new Set(samples.map(s => s.disease).filter(Boolean))];
  const assays = [...new Set(samples.map(s => s.protocol).filter(Boolean))];

  // Sort samples
  const sortedSamples = [...samples].sort((a, b) => {
    let va: string | number | null = null;
    let vb: string | number | null = null;
    if (sortCol === "gsm_id") { va = a.gsm_id; vb = b.gsm_id; }
    else if (sortCol === "status") { va = a.status; vb = b.status; }
    else if (sortCol === "n_cells") { va = a.n_cells ?? -1; vb = b.n_cells ?? -1; }
    else if (sortCol === "mapping_rate") { va = a.mapping_rate ?? -1; vb = b.mapping_rate ?? -1; }
    else if (sortCol === "median_genes") { va = a.median_genes ?? -1; vb = b.median_genes ?? -1; }
    else if (sortCol === "protocol") { va = a.protocol ?? ""; vb = b.protocol ?? ""; }

    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto">

          {/* Breadcrumb */}
          <Link to="/browse" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft size={14} /> Browse
          </Link>

          {/* ── HEADER ── */}
          <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest">{gseId}</h1>
                <a
                  href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${gseId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  GEO <ExternalLink size={10} />
                </a>
              </div>
              {series.title && (
                <p className="text-muted-foreground text-base max-w-2xl">{series.title}</p>
              )}
            </div>
          </div>

          {/* ── METADATA BLOCK ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Organism", value: organisms.join(", ") || "—" },
              { label: "Tissue", value: tissues.slice(0, 3).join(", ") + (tissues.length > 3 ? ` +${tissues.length - 3}` : "") || "—" },
              { label: "Disease", value: diseases.slice(0, 2).join(", ") + (diseases.length > 2 ? ` +${diseases.length - 2}` : "") || "—" },
              { label: "Assay/Protocol", value: assays.slice(0, 2).join(", ") || "—" },
              { label: "Samples", value: `${samples.length} total · ${successSamples.length} pass · ${failedSamples.length} fail` },
              { label: "Total Cells (pass)", value: formatNumber(totalCells) },
              { label: "Avg Mapping Rate", value: avgMR != null ? `${(avgMR * 100).toFixed(1)}%` : "—" },
              { label: "Year", value: formatYear(series.submitted_date) },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-card p-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{item.label}</div>
                <div className="text-sm font-medium text-foreground truncate" title={item.value}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Quality bar */}
          {successSamples.length > 0 && (
            <div className="mb-6 rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Quality Distribution (passing samples)</div>
              <QCSummaryBar samples={samples} />
            </div>
          )}

          {/* ── QC NOTE — amber panel when failed samples exist ── */}
          {failedSamples.length > 0 && (
            <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 mb-1">
                    QC Note — {failedSamples.length} failed sample{failedSamples.length !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-amber-700 mb-2">
                    {failedSamples.length} of {samples.length} samples in this series did not pass QC.
                    Failed samples are included in the catalog for transparency.
                  </p>
                  {topReasons.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-xs text-amber-700 font-medium">Common reasons:</span>
                      {topReasons.map(([reason, count]) => (
                        <span key={reason} className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 border border-amber-200">
                          {reason.replace(/_/g, " ")} ({count})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── PUBLICATIONS ── */}
          {publications.length > 0 && (
            <div className="mb-8">
              <h2 className="font-display text-base font-bold text-foreground mb-3 uppercase tracking-wider">
                Publication{publications.length !== 1 ? "s" : ""}
              </h2>
              <div className="space-y-3">
                {publications.map((pub) => (
                  <PublicationCard key={pub.pmid} pub={pub} />
                ))}
              </div>
            </div>
          )}

          {/* ── ABSTRACT (collapsible) ── */}
          {series.abstract && (
            <div className="mb-8 rounded-lg border border-border bg-card overflow-hidden">
              <button
                onClick={() => setAbstractOpen(!abstractOpen)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-muted/20 transition-colors"
              >
                <span className="text-sm font-semibold text-foreground">Abstract</span>
                {abstractOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
              </button>
              {abstractOpen && (
                <div className="px-5 pb-5 border-t border-border">
                  <p className="text-sm text-muted-foreground leading-relaxed mt-4">{series.abstract}</p>
                </div>
              )}
            </div>
          )}

          {/* ── GSM TABLE ── */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-base font-bold text-foreground uppercase tracking-wider">
                Samples ({samples.length})
              </h2>
              <span className="text-xs text-muted-foreground">
                {successSamples.length} passing · {failedSamples.length} failed
              </span>
            </div>
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {([
                        ["gsm_id", "Sample", "text-left"],
                        ["status", "Status", "text-left"],
                        ["n_cells", "Cells", "text-right"],
                        ["mapping_rate", "Map %", "text-right"],
                        ["median_genes", "Med. Genes", "text-right"],
                        ["protocol", "Protocol", "text-left"],
                      ] as [SortCol, string, string][]).map(([col, label, align]) => (
                        <th
                          key={col}
                          onClick={() => toggleSort(col)}
                          className={`${align} px-4 py-3 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label} <SortIcon col={col} />
                          </span>
                        </th>
                      ))}
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSamples.map((s) => {
                      const isFailed = s.status !== "SUCCESS";
                      return (
                        <tr key={s.gsm_id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${isFailed ? "bg-red-50/30" : ""}`}>
                          <td className="px-4 py-2.5">
                            <Link to={`/sample/${s.gsm_id}`} className="font-mono text-xs text-primary hover:underline">
                              {s.gsm_id}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={s.status} failureCategory={s.failure_category} />
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs">
                            {formatNumber(s.n_cells)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs">
                            {s.mapping_rate != null ? `${(s.mapping_rate * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs">
                            {formatNumber(s.median_genes)}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">{s.protocol ?? "—"}</span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[180px] truncate">
                            {s.title ?? s.source ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── DOWNLOAD SECTION ── */}
          <div>
            <h2 className="font-display text-base font-bold text-foreground mb-3 uppercase tracking-wider">Download</h2>
            <DownloadPanel
              accession={gseId ?? ""}
              r2BundleKey={series.r2_bundle_key}
              r2BundleBytes={series.r2_bundle_bytes}
            />
          </div>

        </div>
      </section>
      <Footer />
    </div>
  );
};

export default SeriesDetail;
