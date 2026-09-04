import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DownloadPanel } from "@/components/DownloadPanel";
import { ConditionsPanel, type ConditionFilter } from "@/components/study/ConditionsPanel";
import { StudySamplesTable } from "@/components/study/StudySamplesTable";
import { apiClient, bundleUrl } from "@/integrations/api/client";
import type { GseDetailResponse, GsmRow, PublicationRow } from "@/integrations/api/types";
import { usePageMeta } from "@/hooks/usePageMeta";
import { failureLabel, fmtCompact, fmtInt, fmtPct, isFailed, isProcessed, organismLabel } from "@/lib/catalog-display";
import { cn } from "@/lib/utils";

const GEO = (acc: string) => `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${acc}`;

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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-8 md:py-10">{children}</main>
      <Footer />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading study">
      <div className="h-3 w-40 rounded bg-secondary mb-6" />
      <div className="h-4 w-56 rounded bg-secondary mb-3" />
      <div className="h-7 w-3/4 rounded bg-secondary mb-3" />
      <div className="h-3 w-1/2 rounded bg-secondary mb-8" />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] gap-8">
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 rounded bg-secondary" />
            ))}
          </div>
          <div className="h-32 rounded bg-secondary" />
        </div>
        <div className="h-72 rounded bg-secondary mt-3 lg:mt-0" />
      </div>
    </div>
  );
}

const StudyDetail = () => {
  const { gse } = useParams<{ gse: string }>();
  const gseId = (gse ?? "").toUpperCase();
  const { hash } = useLocation();
  const highlightGsm = hash ? decodeURIComponent(hash.slice(1)).toUpperCase() : null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["study", gseId],
    queryFn: () => apiClient.gse(gseId),
    enabled: /^GSE\d+$/.test(gseId),
    staleTime: 300_000,
    retry: 1,
  });

  const [abstractOpen, setAbstractOpen] = useState(false);
  const [condition, setCondition] = useState<ConditionFilter | null>(null);

  const toggleCondition = useCallback((f: ConditionFilter) => {
    setCondition((prev) => (prev && prev.key === f.key && prev.value === f.value ? null : f));
    // Bring the (now filtered) samples table into view.
    setTimeout(() => document.getElementById("samples")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }, []);

  // Scroll to #GSM… once the table has rendered (the table auto-expands it).
  useEffect(() => {
    if (!highlightGsm || !data) return;
    const t = setTimeout(() => {
      document.getElementById(highlightGsm)?.scrollIntoView({ block: "center" });
    }, 120);
    return () => clearTimeout(t);
  }, [highlightGsm, data]);

  const derived = useMemo(() => {
    if (!data) return null;
    const { samples, meta, series } = data as GseDetailResponse;
    const processed = samples.filter((s) => isProcessed(s.status));
    const failed = samples.filter((s) => isFailed(s.status));
    const countable = processed.filter((s) => !s.suspect_cells);
    const totalCells = countable.reduce((a, s) => a + (s.n_cells ?? 0), 0);
    const flagged = processed.length - countable.length;
    const withMR = processed.filter((s) => s.mapping_rate != null);
    const avgMR = withMR.length ? withMR.reduce((a, s) => a + (s.mapping_rate ?? 0), 0) / withMR.length : null;
    const withGenes = processed.filter((s) => s.median_genes != null);
    const medGenes = withGenes.length
      ? (() => {
          const v = withGenes.map((s) => s.median_genes as number).sort((a, b) => a - b);
          return v[Math.floor(v.length / 2)];
        })()
      : null;
    const uniq = (pick: (s: GsmRow) => string | null | undefined) => [...new Set(samples.map(pick).filter(Boolean) as string[])];
    const reasons = failed.reduce((acc, s) => {
      const k = s.failure_category ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const organisms = meta?.organisms?.length ? meta.organisms : uniq((s) => s.organism_primary ?? s.organism);
    const tissueGroups = meta?.tissue_groups?.length ? meta.tissue_groups : uniq((s) => s.tissue_group);
    const diseaseGroups = meta?.disease_groups?.length ? meta.disease_groups : uniq((s) => s.disease_group);
    const assays = meta?.assay_families?.length ? meta.assay_families : uniq((s) => s.assay_family ?? s.protocol);
    const tissuesRaw = meta?.tissues_raw?.length ? meta.tissues_raw : uniq((s) => s.tissue);
    const cellTypesRaw = meta?.cell_types_raw?.length ? meta.cell_types_raw : uniq((s) => s.cell_type);
    const versions = uniq((s) => s.singlet_version);
    const dates = samples.map((s) => s.pipeline_date).filter(Boolean).sort() as string[];
    const nRuns = samples.reduce((a, s) => a + (s.srr_ids?.length ?? 0), 0);
    const nWithCharacteristics = samples.filter((s) => s.characteristics && Object.keys(s.characteristics).length > 0).length;
    const year = meta?.year ?? (series.submitted_date ? new Date(series.submitted_date).getFullYear() : null);
    const geoTotal = Math.max(series.n_gsm_total ?? 0, samples.length);
    return {
      processed,
      failed,
      totalCells,
      flagged,
      avgMR,
      medGenes,
      organisms,
      tissueGroups,
      diseaseGroups,
      assays,
      tissuesRaw,
      cellTypesRaw,
      versions,
      dateMin: dates[0] ?? null,
      dateMax: dates[dates.length - 1] ?? null,
      nRuns,
      nWithCharacteristics,
      year,
      geoTotal,
      reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    };
  }, [data]);

  const series = data?.series;
  const hasBundle = !!series?.bundle_url;
  const description = series?.title
    ? `${series.title}. ${derived ? `${organismLabelList(derived.organisms)} · ${fmtInt(derived.processed.length)} processed samples · ${fmtCompact(derived.totalCells)} cells.` : ""} Load it in one line with singlet.`
    : `Reprocessed single-cell data for ${gseId}.`;

  usePageMeta({
    title: series?.title ? `${gseId} — ${series.title}` : gseId,
    description: description.slice(0, 158),
    path: `/study/${gseId}`,
    noindex: !!error,
    jsonLd:
      series && derived
        ? {
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: series.title ? `${gseId}: ${series.title}` : gseId,
            description: series.abstract ?? description,
            identifier: gseId,
            url: `https://singlet.bio/study/${gseId}`,
            sameAs: GEO(gseId),
            isBasedOn: GEO(gseId),
            license: "https://creativecommons.org/publicdomain/zero/1.0/",
            isAccessibleForFree: true,
            keywords: [...derived.organisms.map(organismLabel), ...derived.tissueGroups, ...derived.diseaseGroups, ...derived.assays].filter(Boolean),
            includedInDataCatalog: { "@type": "DataCatalog", name: "singlet.bio", url: "https://singlet.bio" },
            ...(derived.year ? { datePublished: String(derived.year) } : {}),
            ...(hasBundle
              ? {
                  distribution: [
                    {
                      "@type": "DataDownload",
                      encodingFormat: "application/x-singlet",
                      contentUrl: series.bundle_url ?? bundleUrl(gseId),
                      ...(series.bundle_bytes != null ? { contentSize: `${series.bundle_bytes} B` } : {}),
                    },
                  ],
                }
              : {}),
          }
        : null,
  });

  if (isLoading) {
    return (
      <Shell>
        <Skeleton />
      </Shell>
    );
  }

  if (error || !data || !derived || !series) {
    return (
      <Shell>
        <div className="py-12 text-center">
          <h1 className="text-2xl mb-2">Study not found</h1>
          <p className="text-muted-foreground mb-5">
            <span className="font-mono">{gseId || "This accession"}</span> is not in the catalog
            {error && !/404/.test(String((error as Error).message)) ? " right now — the catalog may be unreachable" : ""}.
          </p>
          <div className="flex justify-center gap-3">
            <Link to="/browse" className="btn-secondary btn-sm">Browse the atlas</Link>
            {/^GSE\d+$/.test(gseId) && (
              <a href={GEO(gseId)} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                Look up on GEO <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  const { samples, conditions, publications } = data as GseDetailResponse;
  const {
    processed,
    failed,
    totalCells,
    flagged,
    avgMR,
    medGenes,
    organisms,
    tissueGroups,
    diseaseGroups,
    assays,
    tissuesRaw,
    cellTypesRaw,
    versions,
    dateMin,
    dateMax,
    nRuns,
    nWithCharacteristics,
    year,
    geoTotal,
    reasons,
  } = derived;
  const hasQc = avgMR != null || medGenes != null;

  const metaLine: string[] = [
    organismLabelList(organisms) || "Unknown organism",
    ...(tissueGroups.length ? [tissueGroups.slice(0, 2).join(", ") + (tissueGroups.length > 2 ? ` +${tissueGroups.length - 2}` : "")] : []),
    ...(assays.length ? [assays.slice(0, 2).join(", ")] : []),
    `${fmtInt(processed.length)} / ${fmtInt(samples.length)} samples`,
    totalCells > 0 ? `${fmtCompact(totalCells)} cells` : flagged > 0 ? "cell count under review" : "no cells",
    ...(year ? [String(year)] : []),
  ];

  const facts: { label: string; value: React.ReactNode; title?: string }[] = [
    { label: "Organism", value: organismLabelList(organisms) || "—", title: organisms.join(", ") },
    {
      label: "Tissue",
      value: tissueGroups.length ? tissueGroups.slice(0, 2).join(", ") + (tissueGroups.length > 2 ? ` +${tissueGroups.length - 2}` : "") : "—",
      title: tissuesRaw.length ? `As written on GEO: ${tissuesRaw.join(", ")}` : tissueGroups.join(", "),
    },
    {
      label: "Disease",
      value: diseaseGroups.length ? diseaseGroups.slice(0, 2).join(", ") + (diseaseGroups.length > 2 ? ` +${diseaseGroups.length - 2}` : "") : "—",
      title: diseaseGroups.join(", "),
    },
    { label: "Assay", value: assays.length ? assays.slice(0, 2).join(", ") + (assays.length > 2 ? ` +${assays.length - 2}` : "") : "—", title: assays.join(", ") },
    {
      label: "Samples",
      value: (
        <>
          {fmtInt(processed.length)} processed
          {failed.length > 0 && <span className="text-muted-foreground font-normal"> · {fmtInt(failed.length)} failed</span>}
        </>
      ),
      title: geoTotal > samples.length ? `${samples.length} of ${geoTotal} GEO samples are catalogued` : `${samples.length} samples`,
    },
    {
      label: "Cells in file",
      value:
        totalCells === 0 && flagged > 0 ? (
          <span className="inline-flex items-center gap-1 text-warning font-normal text-[13px]" title="The reported cell counts for these plate-based samples are implausible and are under review.">
            <AlertTriangle size={12} /> under review
          </span>
        ) : (
          <>
            {totalCells > 0 ? fmtCompact(totalCells) : "—"}
            {flagged > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-warning font-normal text-[12px]" title="Cell counts for some plate-based samples are implausible and are under review; they are excluded from this total.">
                <AlertTriangle size={11} /> {flagged} flagged
              </span>
            )}
          </>
        ),
      title:
        flagged > 0
          ? `${flagged} of ${processed.length} processed samples report implausible cell counts (a known plate-based pipeline issue). They are excluded from this total.`
          : undefined,
    },
    // QC tiles only for metrics that were actually recorded; a study with none
    // gets one sentence instead (below the grid), never an em-dash tile.
    ...(avgMR != null ? [{ label: "Mean mapping rate", value: fmtPct(avgMR) }] : []),
    ...(medGenes != null ? [{ label: "Median genes / cell", value: fmtInt(medGenes) }] : []),
  ];

  return (
    <Shell>
      {/* Breadcrumb */}
      <nav className="text-[13px] text-muted-foreground mb-5" aria-label="Breadcrumb">
        <Link to="/browse" className="hover:text-foreground">Browse</Link>
        <span className="mx-2">/</span>
        <span className="font-mono text-foreground">{gseId}</span>
      </nav>

      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-3 flex-wrap text-[13px]">
          <span className="font-mono text-[15px] font-semibold text-primary">{gseId}</span>
          <a href={GEO(gseId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
            View on GEO <ExternalLink size={11} />
          </a>
          {year && <span className="font-mono text-muted-foreground tabular">{year}</span>}
          {series.reference_build && (
            <span className="text-muted-foreground">
              Reference: <span className="font-mono">{series.reference_build}</span>
            </span>
          )}
          {series.pubmed_ids.length > 0 && (
            <span className="text-muted-foreground">
              PubMed:{" "}
              {series.pubmed_ids.map((pmid, i) => (
                <span key={pmid}>
                  {i > 0 && ", "}
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono hover:text-primary"
                  >
                    {pmid}
                  </a>
                </span>
              ))}
            </span>
          )}
        </div>
        <h1 className="mt-1.5 text-[24px] md:text-[28px] font-semibold tracking-tight leading-snug max-w-[900px]">{series.title ?? "Untitled study"}</h1>
        <p className="mt-2 text-[14px] text-muted-foreground tabular">
          {metaLine.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5 text-border-strong">·</span>}
              {p}
            </span>
          ))}
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8 items-start">
        {/* Main column */}
        <div className="min-w-0">
          {/* Failed note */}
          {failed.length > 0 && (
            <div className="warning-surface px-4 py-3 mb-4 text-[13.5px]">
              <p className="font-medium">
                {failed.length} of {samples.length} samples did not complete processing and are not in the file.
              </p>
              {reasons.length > 0 && (
                <p className="mt-1 text-warning/90">
                  {reasons.map(([r, n]) => `${failureLabel(r === "unknown" ? null : r)} (${n})`).join(", ")}.{" "}
                  <Link to="/about#failed" className="underline">What failed means →</Link>
                </p>
              )}
            </div>
          )}

          {/* Facts */}
          <dl className={cn("grid grid-cols-2 md:grid-cols-4 gap-2", hasQc || processed.length === 0 ? "mb-6" : "mb-2")}>
            {facts.map((f) => (
              <div key={f.label} className="surface px-3.5 py-3 min-w-0">
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{f.label}</dt>
                <dd className="text-sm font-medium text-foreground leading-snug line-clamp-2" title={f.title ?? (typeof f.value === "string" ? f.value : undefined)}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
          {!hasQc && processed.length > 0 && (
            <p className="mb-6 text-[12.5px] text-muted-foreground">Per-sample QC metrics were not recorded for this study.</p>
          )}

          {/* Conditions */}
          <section className="mb-6" aria-labelledby="conditions-h">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h2 id="conditions-h" className="text-[18px]">Experimental design</h2>
              <span className="text-[12px] text-muted-foreground">
                read from GEO sample characteristics{nWithCharacteristics < samples.length ? ` (${fmtInt(nWithCharacteristics)} of ${fmtInt(samples.length)} samples annotated)` : ""}
              </span>
            </div>
            <ConditionsPanel
              conditions={conditions}
              nWithCharacteristics={nWithCharacteristics}
              nSamples={samples.length}
              active={condition}
              onToggle={toggleCondition}
              onClear={() => setCondition(null)}
            />
            {(cellTypesRaw.length > 0 || tissuesRaw.length > 1) && (
              <dl className="mt-3 grid gap-2 text-[13px]">
                {tissuesRaw.length > 1 && (
                  <div className="flex gap-3">
                    <dt className="text-muted-foreground shrink-0 w-[92px]">Tissues</dt>
                    <dd className="text-foreground/85">{tissuesRaw.slice(0, 12).join(", ")}{tissuesRaw.length > 12 ? ` +${tissuesRaw.length - 12} more` : ""}</dd>
                  </div>
                )}
                {cellTypesRaw.length > 0 && (
                  <div className="flex gap-3">
                    <dt className="text-muted-foreground shrink-0 w-[92px]">Cell types</dt>
                    <dd className="text-foreground/85">{cellTypesRaw.slice(0, 12).join(", ")}{cellTypesRaw.length > 12 ? ` +${cellTypesRaw.length - 12} more` : ""}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>

          {/* Abstract */}
          {series.abstract && (
            <section className="mb-6" aria-labelledby="abstract-h">
              <h2 id="abstract-h" className="text-[18px] mb-2">Abstract</h2>
              <div className="surface px-4 py-3">
                <p className={cn("text-[14px] text-foreground/85 leading-relaxed", !abstractOpen && "line-clamp-4")}>{series.abstract}</p>
                {series.abstract.length > 420 && (
                  <button onClick={() => setAbstractOpen(!abstractOpen)} className="mt-2 inline-flex items-center gap-1 text-[13px] text-primary hover:underline">
                    {abstractOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {abstractOpen ? "Show less" : "Read the full abstract"}
                  </button>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">From the GEO series record.</p>
              </div>
            </section>
          )}

          {/* Publications */}
          {publications.length > 0 && (
            <section className="mb-6" aria-labelledby="pubs-h">
              <h2 id="pubs-h" className="text-[18px] mb-2">Publication{publications.length !== 1 ? "s" : ""}</h2>
              <div className="space-y-2">
                {publications.map((p) => (
                  <PublicationCard key={p.pmid} pub={p} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Aside: load / download + provenance */}
        <aside className="mt-2 lg:mt-0 lg:sticky lg:top-20 space-y-3" aria-labelledby="download-h">
          <h2 id="download-h" className="text-[18px] lg:sr-only">Load or download</h2>
          {processed.length > 0 ? (
            <DownloadPanel accession={gseId} bundleUrl={series.bundle_url} bundleBytes={series.bundle_bytes} bundleNSamples={series.bundle_n_samples} processedSamples={processed.length} stacked />
          ) : (
            <div className="surface px-4 py-3 text-sm text-muted-foreground">
              No samples in this study completed processing, so there is no <code className="code-inline">.singlet</code> file.
            </div>
          )}
          <dl className="surface px-4 py-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt className="text-muted-foreground">Pipeline</dt>
            <dd className="text-foreground font-mono">{versions.length ? versions.join(", ") : "—"}</dd>
            <dt className="text-muted-foreground">Processed</dt>
            <dd className="text-foreground tabular">{dateMin ? (dateMin === dateMax || !dateMax ? dateMin : `${dateMin} – ${dateMax}`) : "—"}</dd>
            <dt className="text-muted-foreground">Raw reads</dt>
            <dd className="text-foreground tabular">{nRuns > 0 ? `${fmtInt(nRuns)} SRA run${nRuns === 1 ? "" : "s"}` : "—"}</dd>
            <dt className="text-muted-foreground">Catalog updated</dt>
            <dd className="text-foreground tabular">{series.last_updated ? series.last_updated.slice(0, 10) : "—"}</dd>
            <dt className="text-muted-foreground">License</dt>
            <dd>
              <Link to="/data-license" className="text-primary hover:underline">CC0 data · MIT code</Link>
            </dd>
          </dl>
          <p className="text-[12px] text-muted-foreground leading-relaxed px-0.5">
            Every study is run through the same pipeline from raw reads, so this file compares directly with any other on the site.{" "}
            <Link to="/about#pipeline" className="text-primary hover:underline">How processing works →</Link>
          </p>
        </aside>
      </div>

      {/* Samples */}
      <section id="samples" className="mt-8 scroll-mt-20" aria-labelledby="samples-h">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 id="samples-h" className="text-[18px]">Samples</h2>
          <span className="text-[12px] text-muted-foreground">
            Click a row for its GEO characteristics, QC and raw-read records.
            {geoTotal > samples.length ? ` ${fmtInt(samples.length)} of ${fmtInt(geoTotal)} GEO samples are catalogued.` : ""}
          </span>
        </div>
        <StudySamplesTable
          gseId={gseId}
          studyTitle={series.title}
          samples={samples}
          highlightGsm={highlightGsm}
          condition={condition}
          onClearCondition={() => setCondition(null)}
        />
      </section>
    </Shell>
  );
};

function organismLabelList(organisms: string[]): string {
  return [...new Set(organisms.map(organismLabel).filter(Boolean))].join(", ");
}

export default StudyDetail;
