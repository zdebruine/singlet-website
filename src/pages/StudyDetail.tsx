import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DownloadPanel } from "@/components/DownloadPanel";
import { apiClient } from "@/integrations/api/client";
import type { GseDetailResponse, GsmRow, PublicationRow } from "@/integrations/api/types";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  FLAGGED_CELLS_LABEL,
  failureDetail,
  failureLabel,
  fmtCompact,
  fmtInt,
  fmtPct,
  isFailed,
  isProcessed,
  isSuspectCellCount,
  organismLabel,
  protocolLabel,
} from "@/lib/catalog-display";
import { cn } from "@/lib/utils";

function StatusCell({ s }: { s: GsmRow }) {
  if (isProcessed(s.status)) return <span className="status-ok">Processed</span>;
  if (isFailed(s.status)) {
    const detail = failureDetail(s.failure_category);
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className="status-fail">Failed</span>
        {s.failure_category && (
          <span className="text-[11px] text-muted-foreground" title={detail ?? undefined}>
            {failureLabel(s.failure_category)}
          </span>
        )}
      </span>
    );
  }
  return <span className="flag">{s.status}</span>;
}

function PublicationCard({ pub }: { pub: PublicationRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground leading-snug">{pub.title ?? "Untitled"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {pub.journal ?? "Journal unknown"}
            {pub.year ? ` · ${pub.year}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs">
          {pub.doi && (
            <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              DOI <ExternalLink size={10} />
            </a>
          )}
          <a href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
            PubMed <ExternalLink size={10} />
          </a>
        </div>
      </div>
      {pub.abstract && (
        <div className="mt-2">
          <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {open ? "Hide abstract" : "Show abstract"}
          </button>
          {open && <p className="text-[13px] text-muted-foreground leading-relaxed mt-2 border-l-2 border-border pl-3">{pub.abstract}</p>}
        </div>
      )}
    </div>
  );
}

type SortCol = "gsm_id" | "status" | "n_cells" | "mapping_rate" | "median_genes" | "protocol";

const StudyDetail = () => {
  const { gse } = useParams<{ gse: string }>();
  const gseId = (gse ?? "").toUpperCase();
  const { hash } = useLocation();
  const highlightGsm = hash ? decodeURIComponent(hash.slice(1)).toUpperCase() : null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["study", gseId],
    queryFn: () => apiClient.gse(gseId),
    enabled: !!gseId,
    staleTime: 60_000,
  });

  usePageMeta({
    title: data?.series.title ? `${gseId} — ${data.series.title}` : gseId,
    description: data?.series.title
      ? `${data.series.title}. Reprocessed single-cell data for ${gseId}: load it in one line with singlet.`
      : `Reprocessed single-cell data for ${gseId}.`,
    path: `/study/${gseId}`,
  });

  const [sortCol, setSortCol] = useState<SortCol>("gsm_id");
  const [sortAsc, setSortAsc] = useState(true);
  const [abstractOpen, setAbstractOpen] = useState(false);

  // Scroll to and highlight #GSM… once the table is rendered.
  useEffect(() => {
    if (!highlightGsm || !data) return;
    const t = setTimeout(() => {
      document.getElementById(highlightGsm)?.scrollIntoView({ block: "center" });
    }, 60);
    return () => clearTimeout(t);
  }, [highlightGsm, data]);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else {
      setSortCol(col);
      setSortAsc(col === "gsm_id" || col === "status" || col === "protocol");
    }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown size={11} className="opacity-30" />;
    return sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  };

  const derived = useMemo(() => {
    if (!data) return null;
    const { samples } = data as GseDetailResponse;
    const processed = samples.filter((s) => isProcessed(s.status));
    const failed = samples.filter((s) => isFailed(s.status));
    const countable = processed.filter((s) => !isSuspectCellCount(s.protocol, s.n_cells));
    const totalCells = countable.reduce((a, s) => a + (s.n_cells ?? 0), 0);
    const flagged = processed.length - countable.length;
    const withMR = processed.filter((s) => s.mapping_rate != null);
    const avgMR = withMR.length ? withMR.reduce((a, s) => a + (s.mapping_rate ?? 0), 0) / withMR.length : null;
    const uniq = (k: keyof GsmRow) => [...new Set(samples.map((s) => s[k]).filter(Boolean) as string[])];
    const reasons = failed.reduce((acc, s) => {
      if (s.failure_category) acc[s.failure_category] = (acc[s.failure_category] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const sorted = [...samples].sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      if (sortCol === "gsm_id") { va = a.gsm_id; vb = b.gsm_id; }
      else if (sortCol === "status") { va = a.status; vb = b.status; }
      else if (sortCol === "n_cells") { va = a.n_cells ?? -1; vb = b.n_cells ?? -1; }
      else if (sortCol === "mapping_rate") { va = a.mapping_rate ?? -1; vb = b.mapping_rate ?? -1; }
      else if (sortCol === "median_genes") { va = a.median_genes ?? -1; vb = b.median_genes ?? -1; }
      else if (sortCol === "protocol") { va = a.protocol ?? ""; vb = b.protocol ?? ""; }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
    return {
      processed,
      failed,
      totalCells,
      flagged,
      avgMR,
      organisms: uniq("organism"),
      tissues: uniq("tissue"),
      diseases: uniq("disease"),
      protocols: uniq("protocol"),
      reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
      sorted,
    };
  }, [data, sortCol, sortAsc]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="container-site flex-1 py-16 text-center text-sm text-muted-foreground">Loading {gseId}…</main>
        <Footer />
      </div>
    );
  }

  if (error || !data || !derived) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="container-site flex-1 py-20 text-center">
          <h1 className="text-2xl mb-2">Study not found</h1>
          <p className="text-muted-foreground mb-5">
            <span className="font-mono">{gseId}</span> is not in the catalog.
          </p>
          <div className="flex justify-center gap-3">
            <Link to="/browse" className="btn-secondary btn-sm">Browse the atlas</Link>
            <a href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${gseId}`} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
              Look up on GEO <ExternalLink size={12} />
            </a>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const { series, samples, publications } = data as GseDetailResponse;
  const { processed, failed, totalCells, flagged, avgMR, organisms, tissues, diseases, protocols, reasons, sorted } = derived;
  const year = series.submitted_date ? new Date(series.submitted_date).getFullYear() : null;

  const facts: { label: string; value: string; title?: string }[] = [
    { label: "Organism", value: organisms.map(organismLabel).join(", ") || "—", title: organisms.join(", ") },
    { label: "Tissue", value: tissues.slice(0, 3).join(", ") + (tissues.length > 3 ? ` +${tissues.length - 3}` : "") || "—", title: tissues.join(", ") },
    { label: "Disease", value: diseases.slice(0, 2).join(", ") + (diseases.length > 2 ? ` +${diseases.length - 2}` : "") || "—", title: diseases.join(", ") },
    { label: "Assay", value: protocols.slice(0, 2).map(protocolLabel).join(", ") || "—", title: protocols.join(", ") },
    { label: "Samples", value: `${samples.length} · ${processed.length} processed · ${failed.length} failed` },
    { label: "Cells (processed)", value: totalCells > 0 ? fmtCompact(totalCells) + (flagged ? ` +${flagged} flagged` : "") : flagged ? FLAGGED_CELLS_LABEL : "—" },
    { label: "Mean mapping rate", value: fmtPct(avgMR) },
    { label: "Year", value: year ? String(year) : "—" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-8 md:py-10">
        {/* Breadcrumb */}
        <nav className="text-[13px] text-muted-foreground mb-5" aria-label="Breadcrumb">
          <Link to="/browse" className="hover:text-foreground">Browse</Link>
          <span className="mx-2">/</span>
          <span className="font-mono text-foreground">{gseId}</span>
        </nav>

        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-[28px] md:text-[32px] font-semibold tracking-tight">{gseId}</h1>
            <a
              href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${gseId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
            >
              GEO <ExternalLink size={11} />
            </a>
          </div>
          {series.title && <p className="mt-2 text-[17px] text-foreground/90 max-w-[820px] leading-snug">{series.title}</p>}
        </header>

        {/* Facts */}
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
          {facts.map((f) => (
            <div key={f.label} className="surface px-3.5 py-3">
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{f.label}</dt>
              <dd className="text-sm font-medium text-foreground truncate" title={f.title ?? f.value}>{f.value}</dd>
            </div>
          ))}
        </dl>

        {/* Failed note */}
        {failed.length > 0 && (
          <div className="warning-surface px-4 py-3 mb-6 text-[13.5px]">
            <p className="font-medium">
              {failed.length} of {samples.length} samples did not complete processing and are not in the bundle.
            </p>
            {reasons.length > 0 && (
              <p className="mt-1 text-warning/90">
                Reasons: {reasons.map(([r, n]) => `${failureLabel(r)} (${n})`).join(", ")}.{" "}
                <Link to="/about#failed" className="underline">What failed means →</Link>
              </p>
            )}
          </div>
        )}

        {/* Download */}
        <section className="mb-8" aria-labelledby="download-h">
          <h2 id="download-h" className="text-[18px] mb-3">Load or download</h2>
          {processed.length > 0 ? (
            <DownloadPanel accession={gseId} r2BundleKey={series.r2_bundle_key} r2BundleBytes={series.r2_bundle_bytes} />
          ) : (
            <div className="surface px-4 py-3 text-sm text-muted-foreground">
              No samples in this study completed processing, so there is no <code className="code-inline">.singlet</code> file.
            </div>
          )}
        </section>

        {/* Publications */}
        {publications.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[18px] mb-3">Publication{publications.length !== 1 ? "s" : ""}</h2>
            <div className="space-y-2">
              {publications.map((p) => (
                <PublicationCard key={p.pmid} pub={p} />
              ))}
            </div>
          </section>
        )}

        {/* Abstract */}
        {series.abstract && (
          <section className="mb-8 surface overflow-hidden">
            <button onClick={() => setAbstractOpen(!abstractOpen)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-background transition-colors">
              <span className="text-sm font-medium">Abstract (from GEO)</span>
              {abstractOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
            </button>
            {abstractOpen && (
              <div className="px-4 pb-4 border-t border-border">
                <p className="text-sm text-foreground/85 leading-relaxed mt-3">{series.abstract}</p>
              </div>
            )}
          </section>
        )}

        {/* Samples */}
        <section className="mb-4">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <h2 className="text-[18px]">Samples ({samples.length})</h2>
            <span className="text-xs text-muted-foreground">
              {processed.length} processed · {failed.length} failed
            </span>
          </div>
          <div className="surface rounded-none overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {(
                    [
                      ["gsm_id", "Sample", ""],
                      ["status", "Status", ""],
                      ["n_cells", "Cells", "num"],
                      ["mapping_rate", "Mapped", "num"],
                      ["median_genes", "Median genes", "num"],
                      ["protocol", "Protocol", ""],
                    ] as [SortCol, string, string][]
                  ).map(([col, label, cls]) => (
                    <th key={col} onClick={() => toggleSort(col)} className={cn("cursor-pointer select-none hover:text-foreground", cls)}>
                      <span className="inline-flex items-center gap-1">
                        {label} <SortIcon col={col} />
                      </span>
                    </th>
                  ))}
                  <th>Source / title</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const failedRow = isFailed(s.status);
                  const hl = highlightGsm === s.gsm_id.toUpperCase();
                  return (
                    <tr key={s.gsm_id} id={s.gsm_id} className={cn(hl && "bg-primary/[0.06]", failedRow && "text-muted-foreground")}>
                      <td>
                        <a
                          href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${s.gsm_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-primary hover:underline"
                          title="Open on GEO"
                        >
                          {s.gsm_id}
                        </a>
                      </td>
                      <td><StatusCell s={s} /></td>
                      <td className="num text-xs">
                        {isSuspectCellCount(s.protocol, s.n_cells) ? (
                          <span className="flag font-sans" title="Known plate-protocol counting bug — value withheld until the pipeline fix lands">{FLAGGED_CELLS_LABEL}</span>
                        ) : (
                          fmtInt(s.n_cells)
                        )}
                      </td>
                      <td className="num text-xs">{fmtPct(s.mapping_rate)}</td>
                      <td className="num text-xs">{fmtInt(s.median_genes)}</td>
                      <td className="text-xs whitespace-nowrap">{protocolLabel(s.protocol)}</td>
                      <td className="text-xs text-muted-foreground max-w-[260px] truncate" title={s.source ?? s.title ?? undefined}>
                        {s.source ?? s.title ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default StudyDetail;
